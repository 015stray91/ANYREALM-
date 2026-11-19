/**
 * Terminal: a real shell over a PTY.
 *
 * This is deliberately not a command runner. A command runner captures stdout,
 * which loses the tty: no prompts, no colours, no Ctrl-C, no full-screen tools,
 * and no way to answer a question a tool asks. A PTY gives all of it, because
 * the shell believes it is talking to a terminal.
 *
 * The cost of a real shell is real risk, so the bounds are part of the design
 * rather than an afterthought:
 *
 *   - scrollback is capped. An unbounded buffer plus `yes` is a memory leak that
 *     takes the whole builder down.
 *   - every session has an idle deadline and an absolute lifetime. A tab left
 *     open overnight is a process nobody remembers starting.
 *   - the list of sessions is visible and endable from the UI. A shell you
 *     cannot see is a shell you cannot stop.
 *
 * The socket carries raw bytes both ways. Resize is a control frame because a
 * PTY cannot infer size and a 80x24 default garbles anything that draws a box.
 */

import pty from "node-pty";
// The assistant lives with the shell: asking a question about the error on screen
// should not mean leaving the terminal. The engine is a module, not a separate
// tab, so there is one place to read what it knows.
import { mount as mountAssistant } from "../ai-engine/engine.mjs";
// The terminal owns the VM: models, speech, and the tunnel the assistant talks
// through. Keeping it here rather than in a separate panel means one screen
// holds the shell, the question box, and the machine that answers.
import { createVm } from "./vm.mjs";
// The join between the terminal's machines and the platform's compile router.
import { mountConnectRouter } from "./connect-router.mjs";
// Model providers that are an API rather than a machine.
import { createProviders } from "./providers.mjs";
import fs from "fs";
import path from "path";
import os from "os";

/** Bytes kept per session for replay. ~2 MB is a lot of screen and still small. */
const MAX_SCROLLBACK = 2 * 1024 * 1024;
/** A shell with no input for this long is closed. */
const IDLE_MS = 30 * 60 * 1000;
/** Even an active shell is closed eventually: a forgotten build log should not run forever. */
const MAX_LIFETIME_MS = 8 * 60 * 60 * 1000;
/** Never more than this many shells at once. */
const MAX_SESSIONS = 6;

/** Sessions by id. Module scope so a reload of the plugin keeps live shells. */
const sessions = new Map();

let nextId = 1;

function pickShell() {
  // $SHELL first, then the login shell for this user, then sh. Never hardcode
  // bash: this workspace does not guarantee it.
  const candidates = [
    process.env.SHELL,
    (() => {
      try {
        const line = fs.readFileSync("/etc/passwd", "utf8").split("\n").find((l) => l.startsWith(`${process.env.USER}:`));
        return line ? line.split(":")[6] : null;
      } catch {
        return null;
      }
    })(),
    "/bin/bash",
    "/bin/sh",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return "/bin/sh";
}

function trim(session) {
  if (session.buffer.length <= MAX_SCROLLBACK) return;
  // Keep the tail: the beginning of a long log is the part nobody needs.
  session.buffer = session.buffer.slice(session.buffer.length - MAX_SCROLLBACK);
  session.trimmed = true;
}

function describe(session) {
  return {
    id: session.id,
    shell: session.shell,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    running: !!session.proc,
    detached: !session.clients.size,
    pty: session.pty || null,
    clientCount: session.clients.size,
    buffered: session.buffer.length,
    trimmed: !!session.trimmed,
    /** What will end this session, so an unexplained close is explainable. */
    limits: { idleMinutes: IDLE_MS / 60000, maxHours: MAX_LIFETIME_MS / 3600000, maxScrollbackKB: MAX_SCROLLBACK / 1024 },
  };
}

/**
 * Write to every attached socket.
 *
 * A closed socket throws on write, and one dead tab must not stop the output
 * from reaching the others — so failures are collected and those clients are
 * dropped rather than allowed to break the loop.
 */
function broadcast(session, chunk) {
  for (const ws of session.clients) {
    try {
      if (ws.readyState === 1) ws.send(chunk);
      else session.clients.delete(ws);
    } catch {
      session.clients.delete(ws);
    }
  }
}

function startPty(session, cols, rows) {
  const shell = pickShell();
  session.shell = shell;
  session.cols = cols || 100;
  session.rows = rows || 30;

  // TERM matters: without a real one, colour and cursor addressing are off.
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    // Tells tools that something is watching, so pagers behave.
    PAGER: "cat",
    LESS: "-R",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  let proc;
  try {
    proc = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env,
    });
  } catch (e) {
    // A missing-pty error is the common one (no /dev/ptmx in a container). Say
    // the real reason rather than "terminal failed".
    session.lastError = `could not start a pty: ${e.message}`;
    broadcast(session, `\r\n\x1b[31m${session.lastError}\x1b[0m\r\n`);
    return null;
  }

  session.proc = proc;
  session.pid = proc.pid;
  // The PTY device path is genuinely useful: it proves the shell has a tty and
  // shows which one.
  session.pty = proc.pty || null;

  proc.onData((data) => {
    session.lastActivity = Date.now();
    session.buffer += data;
    trim(session);
    broadcast(session, data);
  });

  proc.onExit(({ exitCode, signal }) => {
    session.proc = null;
    session.exit = { exitCode, signal, at: Date.now() };
    broadcast(session, `\r\n\x1b[90m[shell exited: code ${exitCode}${signal ? `, signal ${signal}` : ""}]\x1b[0m\r\n`);
    session.clients.forEach((ws) => {
      try {
        ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      } catch {
        /* tab already gone */
      }
    });
  });

  return proc;
}

export async function register(ctx) {
  const workDir = ctx.workDir();

  const vm = createVm(ctx);

  /**
   * Reopen tunnels after a restart if they were up before.
   *
   * A tunnel is a child of this process, so a reload kills it and the assistant
   * silently loses its model. `wanted` records intent separately from liveness,
   * so reconnecting is the truthful reading of "it was working a moment ago".
   */
  for (const c of vm.state().connections) {
    if (c.purpose === "model" && c.activeId && vm.wantsTunnel(c.id)) {
      setTimeout(() => {
        const r = vm.openTunnel(c.id);
        ctx.log(r.ok ? `tunnel reopened for ${c.id} -> ${r.port}` : `tunnel reopen failed for ${c.id}: ${r.error}`);
      }, 1500);
    }
  }

  // /ai/status, /ai/ask, /ai/history, /ai/provider/test
  // The model is whatever the model connection currently serves, not a fixed
  // environment variable.
  const providers = createProviders(ctx);

  await mountAssistant(ctx, "/ai", {
    // Two ways to reach a model: an activated API key, or the VM tunnel.
    getApiProvider: () => providers.runtime(),
    getProviderBase: () => vm.providerBase(),
    getModelName: () => vm.providerModel(),
  });

  /* ---- API model providers ---------------------------------------- */

  ctx.route("/vm/providers", (req, res) => {
    if (req.method === "GET") {
      return res.json({
        presets: providers.PRESETS,
        providers: providers.list(),
        activeId: providers.state().activeId,
        // Cline is a client, not a source of inference. Saying so here is
        // kinder than letting someone hunt for a key that does not exist.
        note:
          "Cline is a client, not a provider: point it at the same OpenRouter key and it uses the model you pick here.",
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "use POST" });

    const r = providers.add(req.body ?? {});
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  });

  ctx.route("/vm/providers/:id", (req, res) => {
    const id = req.params.id;
    if (req.method === "DELETE") {
      const r = providers.remove(id);
      return res.status(r.ok ? 200 : 404).json(r);
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      if (req.body?.model) return res.json(providers.setModel(id, req.body.model));
      if (req.body?.activate) return res.json(providers.activate(id));
      return res.status(400).json({ error: "send { model } or { activate: true }" });
    }
    res.status(405).json({ error: "use PUT or DELETE" });
  });

  ctx.route("/vm/providers/:id/test", async (req, res) => {
    const r = await providers.test(req.params.id === "active" ? null : req.params.id);
    res.status(r.ok ? 200 : 502).json(r);
  });

  // The terminal owns which machines exist; the platform owns where the next
  // build goes. This publishes one to the other.
  mountConnectRouter(ctx, vm);

  /* ---- connections ------------------------------------------------ */

  ctx.route("/vm/state", (_req, res) => {
    res.json({
      purposes: vm.PURPOSES,
      connections: vm.connections(),
      /** Both slots are visible even when empty, so the shape is obvious. */
      slots: vm.PURPOSES.map((p) => {
        const c = vm.state().connections.find((x) => x.purpose === p.id);
        return {
          purpose: p.id,
          label: p.label,
          detail: p.detail,
          needs: p.needs,
          filled: !!c,
          id: c?.id ?? null,
        };
      }),
    });
  });

  ctx.route("/vm/connections/:id", (req, res) => {
    const c = vm.conn(req.params.id);
    if (!c) return res.status(404).json({ error: `no connection "${req.params.id}"` });
    if (req.method !== "PUT" && req.method !== "PATCH") return res.status(405).json({ error: "use PUT" });
    const body = req.body ?? {};
    if (body.label) c.label = String(body.label).slice(0, 60);
    if (body.provider) c.provider = String(body.provider).slice(0, 24);
    if (body.paths && typeof body.paths === "object") {
      // Only known keys: paths come from the UI and become commands on another
      // machine, so an arbitrary key is not accepted.
      for (const k of ["models", "llama", "whisper", "whisperModel"]) {
        if (typeof body.paths[k] === "string" && body.paths[k].startsWith("/")) {
          c.paths[k] = body.paths[k];
        }
      }
    }
    vm.save();
    res.json({ ok: true, connection: vm.describe(c) });
  });

  /* ---- endpoints (per connection) --------------------------------- */

  ctx.route("/vm/connections/:id/endpoints", (req, res) => {
    const c = vm.conn(req.params.id);
    if (!c) return res.status(404).json({ error: `no connection "${req.params.id}"` });
    if (req.method === "GET") return res.json({ endpoints: c.endpoints, activeId: c.activeId });
    if (req.method !== "POST") return res.status(405).json({ error: "use POST" });

    const body = req.body ?? {};
    const host = String(body.host ?? "").trim();
    const user = String(body.user ?? "").trim();
    if (!host) return res.status(400).json({ error: "host is required" });
    // A pasted URL is the common mistake; catch it here instead of letting ssh
    // fail with something unreadable.
    if (/[:/\s]/.test(host)) return res.status(400).json({ error: `host must be a bare hostname or IP, not "${host}"` });
    if (!user) return res.status(400).json({ error: "user is required" });

    const ep = {
      id: `ep-${Date.now().toString(36)}`,
      label: String(body.label ?? host).slice(0, 60),
      host,
      user,
      kind: ["lan", "public", "tunnel"].includes(body.kind) ? body.kind : "public",
      // Stored per endpoint: two machines rarely share a key, and a missing
      // identity silently falls back to the global one, which then authenticates
      // as the wrong user and looks like a network failure.
      identity: body.identity ? String(body.identity).trim() : null,
      addedAt: Date.now(),
    };
    c.endpoints.push(ep);
    if (!c.activeId) c.activeId = ep.id;
    vm.save();
    res.json({ ok: true, endpoint: ep, activeId: c.activeId });
  });

  ctx.route("/vm/connections/:id/endpoints/:epId", (req, res) => {
    const c = vm.conn(req.params.id);
    if (!c) return res.status(404).json({ error: `no connection "${req.params.id}"` });
    const idx = c.endpoints.findIndex((e) => e.id === req.params.epId);
    if (idx < 0) return res.status(404).json({ error: `no endpoint "${req.params.epId}"` });

    if (req.method === "DELETE") {
      c.endpoints.splice(idx, 1);
      if (c.activeId === req.params.epId) {
        // Never silently fall back to another address: that is how a build talks
        // to the wrong machine.
        c.activeId = null;
        vm.closeTunnel(c.id);
      }
      vm.save();
      return res.json({ ok: true, connection: vm.describe(c) });
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      const body = req.body ?? {};
      if (body.host) {
        if (/[:/\s]/.test(String(body.host))) return res.status(400).json({ error: "host must be a bare hostname or IP" });
        c.endpoints[idx].host = String(body.host).trim();
      }
      if (body.user) c.endpoints[idx].user = String(body.user).trim();
      if (body.label) c.endpoints[idx].label = String(body.label).slice(0, 60);
      if (body.kind) c.endpoints[idx].kind = body.kind;
      vm.save();
      return res.json({ ok: true, endpoint: c.endpoints[idx] });
    }

    res.status(405).json({ error: "use PUT or DELETE" });
  });

  ctx.route("/vm/connections/:id/activate", (req, res) => {
    const c = vm.conn(req.params.id);
    if (!c) return res.status(404).json({ error: `no connection "${req.params.id}"` });
    const id = String(req.body?.id ?? "");
    const ep = c.endpoints.find((e) => e.id === id);
    if (!ep) return res.status(404).json({ error: `no endpoint "${id}"` });
    // The tunnel points at the old host, so it cannot survive a switch.
    vm.closeTunnel(c.id);
    c.activeId = id;
    vm.save();
    res.json({ ok: true, active: ep, note: "tunnel closed — reopen it for this address" });
  });

  ctx.route("/vm/connections/:id/probe", async (req, res) => {
    const id = req.params.id;
    const epId = String(req.query.endpoint ?? req.body?.endpoint ?? "") || undefined;
    const outcome = await vm.probe(id, epId);
    if (outcome.error && !outcome.endpointId) return res.status(400).json(outcome);
    res.json(outcome);
  });

  /* ---- models (model connection only) ---------------------------- */

  ctx.route("/vm/connections/:id/models", async (req, res) => {
    res.json(await vm.listModels(req.params.id));
  });

  ctx.route("/vm/connections/:id/models/start", async (req, res) => {
    const r = await vm.startServer(req.params.id, req.body?.path);
    res.status(r.ok ? 200 : 502).json(r);
  });

  ctx.route("/vm/connections/:id/models/stop", async (req, res) => {
    res.json(await vm.stopServer(req.params.id));
  });

  ctx.route("/vm/connections/:id/models/download", async (req, res) => {
    const r = await vm.downloadModel(req.params.id, req.body?.url, req.body?.name);
    res.status(r.ok ? 200 : 400).json(r);
  });

  ctx.route("/vm/connections/:id/models/download/:name", async (req, res) => {
    res.json(await vm.downloadProgress(req.params.id, req.params.name));
  });

  /* ---- tunnel ----------------------------------------------------- */

  ctx.route("/vm/connections/:id/tunnel", async (req, res) => {
    const id = req.params.id;
    if (req.method === "DELETE") {
      vm.closeTunnel(id);
      return res.json({ ok: true, connection: vm.describe(vm.conn(id)) });
    }
    if (req.method === "POST") {
      const r = vm.openTunnel(id);
      if (!r.ok) return res.status(400).json(r);
      // A tunnel that has not forwarded yet is not up; claiming it is would be a
      // lie the user then acts on.
      await new Promise((ok) => setTimeout(ok, 1200));
      const health = await vm.tunnelHealth(id);
      return res.json({ ok: true, port: r.port, health, connection: vm.describe(vm.conn(id)) });
    }
    res.json({ connection: vm.describe(vm.conn(id)), health: await vm.tunnelHealth(id) });
  });

  /* ---- speech ----------------------------------------------------- */

  ctx.route("/vm/transcribe", async (req, res) => {
    const body = req.body ?? {};
    if (!body.audio) return res.status(400).json({ error: "audio is required (base64 WAV)" });
    const modelConn = vm.state().connections.find((c) => c.purpose === "model");
    if (!modelConn) return res.status(400).json({ error: "no model connection configured" });
    const r = await vm.transcribe(body.connection ?? modelConn.id, body.audio, body.mime);
    res.status(r.ok ? 200 : 400).json(r);
  });

  // A landed session's cwd should exist between restarts, or every new shell
  // opens in a directory that vanished.
  let defaultCwd = os.homedir();
  try {
    if (!fs.existsSync(defaultCwd)) defaultCwd = "/";
  } catch {
    defaultCwd = "/";
  }

  ctx.route("/sessions", (req, res) => {
    if (req.method === "GET") {
      return res.json({
        sessions: [...sessions.values()].map(describe),
        limits: { maxSessions: MAX_SESSIONS, idleMinutes: IDLE_MS / 60000, maxHours: MAX_LIFETIME_MS / 3600000 },
        shell: pickShell(),
      });
    }
    // POST -> create
    const live = [...sessions.values()].filter((s) => s.proc).length;
    if (live >= MAX_SESSIONS) {
      return res.status(429).json({
        error: `${live} shells are already running (limit ${MAX_SESSIONS}). End one before opening another — each is a real process with real memory.`,
        sessions: [...sessions.values()].map(describe),
      });
    }
    const body = req.body ?? {};
    const cwd = String(body.cwd ?? defaultCwd);
    if (!fs.existsSync(cwd)) return res.status(400).json({ error: `working directory does not exist: ${cwd}` });

    const session = {
      id: `term-${nextId++}`,
      cwd,
      buffer: "",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      clients: new Set(),
      proc: null,
      cols: 100,
      rows: 30,
      label: String(body.label ?? ""),
    };
    sessions.set(session.id, session);

    const cols = Number(body.cols) || 100;
    const rows = Number(body.rows) || 30;
    const proc = startPty(session, cols, rows);
    if (!proc) {
      return res.status(500).json({ error: session.lastError, session: describe(session) });
    }
    return res.json({ session: describe(session) });
  });

  ctx.route("/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: `no session "${req.params.id}"` });
    if (req.method === "DELETE") {
      // End the shell, but keep the transcript readable until it is cleared.
      try {
        session.proc?.kill();
      } catch {
        /* already dead */
      }
      session.proc = null;
      return res.json({ ok: true, session: describe(session) });
    }
    res.json({ session: describe(session), scrollback: session.buffer });
  });

  ctx.route("/sessions/:id/clear", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: `no session "${req.params.id}"` });
    // Full removal: the one that really frees the memory.
    try {
      session.proc?.kill();
    } catch {
      /* already dead */
    }
    for (const ws of session.clients) {
      try {
        ws.close();
      } catch {
        /* gone */
      }
    }
    sessions.delete(session.id);
    res.json({ ok: true, remaining: sessions.size });
  });

  // ---- socket -------------------------------------------------------------
  // Raw bytes out of the PTY, raw keystrokes in. Control frames are JSON strings
  // distinguished by a leading \x00, because a keystroke is arbitrary bytes and
  // cannot be told apart from JSON by inspection.
  ctx.wsRoute("/ws", (ws, req) => {
    const url = new URL(String(req.url), "http://x");
    const id = url.searchParams.get("session");
    const session = id ? sessions.get(id) : null;
    if (!session) {
      try {
        ws.send(JSON.stringify({ type: "error", error: `no session "${id}"` }));
        ws.close();
      } catch {
        /* gone */
      }
      return;
    }

    session.clients.add(ws);
    session.lastActivity = Date.now();

    // Replay what happened while nobody was watching, so a reload does not lose
    // the output that was the reason for connecting.
    try {
      ws.send(JSON.stringify({ type: "hello", session: describe(session), replayed: session.buffer.length }));
      if (session.buffer) ws.send(session.buffer);
    } catch {
      /* gone */
    }

    ws.on("message", (raw) => {
      session.lastActivity = Date.now();
      const text = String(raw);
      // Control frames start with \x00: resize and signals.
      if (text.charCodeAt(0) === 0) {
        try {
          const msg = JSON.parse(text.slice(1));
          if (msg.type === "resize" && session.proc) {
            const cols = Math.max(20, Math.min(400, Number(msg.cols) || 100));
            const rows = Math.max(5, Math.min(200, Number(msg.rows) || 30));
            session.cols = cols;
            session.rows = rows;
            session.proc.resize(cols, rows);
          }
          if (msg.type === "signal" && session.proc) {
            // Ctrl-C from a button, for when the terminal has focus problems.
            session.proc.write("\x03");
          }
        } catch {
          /* malformed control frame; ignore rather than kill the stream */
        }
        return;
      }
      if (!session.proc) {
        try {
          ws.send(`\r\n\x1b[90m[this shell has exited; open a new session]\x1b[0m\r\n`);
        } catch {
          /* gone */
        }
        return;
      }
      session.proc.write(text);
    });

    ws.on("close", () => {
      session.clients.delete(ws);
    });
  });

  // ---- housekeeping -------------------------------------------------------
  // Idle and lifetime limits are checked on a timer, not on connect: a shell
  // nobody reconnects to is exactly the one that needs closing.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (!s.proc) continue;
      const idleFor = now - s.lastActivity;
      const age = now - s.createdAt;
      if (idleFor > IDLE_MS || age > MAX_LIFETIME_MS) {
        const why = idleFor > IDLE_MS ? `${Math.round(idleFor / 60000)} min idle` : `${Math.round(age / 3600000)} h old`;
        broadcast(s, `\r\n\x1b[33m[closing: ${why}]\x1b[0m\r\n`);
        try {
          s.proc.kill();
        } catch {
          /* already dead */
        }
        s.proc = null;
        ctx.log(`closed ${id} (${why})`);
      }
    }
  }, 60_000);
  if (sweep.unref) sweep.unref();

  ctx.log(`shell ${pickShell()}, limits: ${MAX_SESSIONS} sessions, ${IDLE_MS / 60000} min idle`);
}
