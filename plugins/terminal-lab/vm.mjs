/**
 * Connections to the machines that do the heavy work.
 *
 * Two kinds of machine sit behind this app, and they are not interchangeable:
 *
 *   MODEL   holds the GGUF model, runs llama-server, and transcribes voice.
 *           The assistant talks to it. A 4.7 GB file lives on it, not here.
 *
 *   ENGINE  is the machine the main app dispatches builds to — the one with the
 *           kernel tree, the firmware, and the disk to assemble an image.
 *
 * Both are the same shape on the wire (a host, a user, an optional tunnel), so
 * they are the same object with a `purpose`. That matters because the same
 * person may have an Azure box for builds and an AWS box for models, and later
 * an IBM one; adding a third machine must be data entry, not a code change.
 *
 * Each connection has its own pool of endpoints. An endpoint is one address you
 * can reach that machine at — LAN, public IP, tunnel — because which one works
 * depends on the network you are on. Exactly one is active per connection.
 *
 * Nothing is hardcoded to a host, a provider, or an IP. `provider` is a label
 * ("azure", "aws", "ibm", "homelab") that changes the hint text and nothing else.
 */

import fs from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import os from "os";

/** Defaults for the model machine. Overridable per connection. */
const DEFAULT_PATHS = {
  models: "/mnt/anyrealm/models",
  llama: "/mnt/anyrealm/llama/llama-b12553",
  whisper: "/mnt/anyrealm/whisper/whisper-bin-ubuntu-x64",
  whisperModel: "/mnt/anyrealm/models/ggml-base.en.bin",
};

/** llama-server listens here on the model machine. */
const LLAMA_PORT = 8090;
/** First local port used for tunnels; each connection takes the next one. */
const TUNNEL_BASE = 18090;

/** The two purposes that exist, with what they are for. */
export const PURPOSES = [
  {
    id: "model",
    label: "Model",
    detail:
      "Holds the GGUF model, runs llama-server, and transcribes voice. The assistant answers from this machine.",
    needs: ["llama.cpp", "a .gguf model"],
  },
  {
    id: "engine",
    label: "Build engine",
    detail:
      "The machine builds are dispatched to: kernel tree, firmware and output disk. The main app's compile routes point here.",
    needs: ["a kernel tree", "output disk"],
  },
];

function expandKey(p) {
  if (!p) return null;
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function sshKey() {
  return expandKey(process.env.ANYREALM_VM_KEY) ?? expandKey("~/.ssh/anyrealm-vm");
}

/**
 * Run a command on an endpoint.
 *
 * BatchMode=yes matters: without it a wrong key becomes an interactive prompt
 * that blocks until the socket timeout, and the UI reports "unreachable" when
 * the truth is "unauthorised". Those need different fixes.
 */
export function sshExec(endpoint, command, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const args = [
      // The endpoint's own key wins. A single global key means the second
      // machine you add fails to authenticate and looks unreachable, which
      // sends you looking at the network instead of at the key.
      "-i", expandKey(endpoint.identity) ?? sshKey(),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=10",
      `${endpoint.user}@${endpoint.host}`,
      command,
    ];
    execFile("ssh", args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err?.code ?? 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: err ? (err.killed ? `timed out after ${timeoutMs} ms` : String(stderr || err.message).trim()) : null,
      });
    });
  });
}

/* ------------------------------------------------------------------ */

export function createVm(ctx) {
  const workDir = ctx.workDir();
  const statePath = path.join(workDir, "vm.json");

  /**
   * State shape:
   *
   *   { connections: [ { id, purpose, label, provider, endpoints[], activeId,
   *                      paths{}, modelName, tunnel{wanted,up,port} } ] }
   *
   * The older single-pool shape ({ endpoints, activeId, ... }) is migrated on
   * read: it was exactly one machine, and its purpose was the model.
   */
  let state = { connections: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (Array.isArray(raw.connections)) {
      state = raw;
    } else if (Array.isArray(raw.endpoints)) {
      state = {
        connections: [
          {
            id: "model",
            purpose: "model",
            label: "Model VM",
            provider: "other",
            endpoints: raw.endpoints,
            activeId: raw.activeId ?? null,
            paths: { ...DEFAULT_PATHS },
            modelName: raw.modelName ?? null,
            tunnel: raw.tunnel ?? null,
          },
        ],
      };
      ctx.log("migrated vm.json: single endpoint pool -> a 'model' connection");
    }
  } catch {
    /* first run */
  }

  /**
   * Both slots always exist, even when empty.
   *
   * Filled per purpose, not just when the list is empty: a migration from the
   * single-pool shape leaves a model connection behind, and the build engine
   * slot would otherwise be missing — so the UI shows one machine and no way to
   * add the second.
   */
  for (const p of PURPOSES) {
    if (!state.connections.some((c) => c.purpose === p.id)) {
      state.connections.push({
        id: p.id,
        purpose: p.id,
        label: p.id === "model" ? "Model VM" : "Build engine VM",
        provider: "other",
        endpoints: [],
        activeId: null,
        paths: { ...DEFAULT_PATHS },
        modelName: null,
        tunnel: null,
      });
    }
  }
  // Order matches the catalogue, not insertion order, so the model slot is
  // always first.
  state.connections.sort((a, b) => PURPOSES.findIndex((p) => p.id === a.purpose) - PURPOSES.findIndex((p) => p.id === b.purpose));
  // Persist the shape: a slot that exists only in memory is a slot the next
  // restart has to rediscover, and until then the UI shows one machine.
  if (!fs.existsSync(statePath)) save();

  const save = () => {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (e) {
      ctx.log(`could not save vm state: ${e.message}`);
    }
  };

  const conn = (id) => state.connections.find((c) => c.id === id) ?? null;
  const activeFor = (c) => c?.endpoints.find((e) => e.id === c.activeId) ?? null;

  // Tunnels are per connection: two machines, two local ports.
  const tunnels = new Map(); // id -> ChildProcess

  function tunnelPortFor(id) {
    const idx = state.connections.findIndex((c) => c.id === id);
    return TUNNEL_BASE + Math.max(0, idx);
  }

  /* ---- tunnels ---------------------------------------------------- */

  function openTunnel(id) {
    const c = conn(id);
    if (!c) return { ok: false, error: `no connection "${id}"` };
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint for this connection" };
    if (tunnels.get(id)) return { ok: true, already: true, port: tunnelPortFor(id) };

    const port = tunnelPortFor(id);
    // Only the model machine runs a server worth forwarding. Tunnelling the
    // build engine would forward a port nothing listens on, so it is refused
    // rather than opened and then declared broken.
    if (c.purpose !== "model") {
      return {
        ok: false,
        error: "only the model connection needs a tunnel — the build engine is reached by ssh, not by a forwarded port",
      };
    }

    const args = [
      "-i", sshKey(),
      "-N",
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=10",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=20",
      "-o", "ServerAliveCountMax=2",
      "-L", `${port}:127.0.0.1:${LLAMA_PORT}`,
      `${ep.user}@${ep.host}`,
    ];
    const proc = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    tunnels.set(id, proc);

    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    proc.on("exit", (code) => {
      tunnels.delete(id);
      const c2 = conn(id);
      if (c2) {
        // `wanted` is intent, `up` is fact. Inferring intent from a dead tunnel
        // is how a restart silently loses the model: the exit handler sets
        // up:false, and the next start would read that as "the user does not
        // want a tunnel".
        c2.tunnel = {
          up: false,
          wanted: c2.tunnel?.wanted !== false,
          port,
          since: Date.now(),
          code,
          stderr: stderr.trim().slice(-600),
        };
        save();
      }
      if (code) ctx.log(`tunnel for ${id} exited (${code}): ${stderr.trim().slice(0, 200)}`);
    });

    c.tunnel = { up: true, wanted: true, port, since: Date.now(), endpointId: ep.id };
    save();
    return { ok: true, port };
  }

  function closeTunnel(id) {
    const proc = tunnels.get(id);
    if (proc) {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      tunnels.delete(id);
    }
    const c = conn(id);
    if (c) {
      c.tunnel = { up: false, wanted: false, port: tunnelPortFor(id), since: Date.now(), stopped: true };
      save();
    }
  }

  async function tunnelHealth(id) {
    const port = tunnelPortFor(id);
    if (!tunnels.get(id)) return { up: false, why: "no tunnel process" };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(6000) });
      const body = await res.text();
      if (!res.ok) return { up: false, status: res.status, body: body.slice(0, 200) };
      const c = conn(id);
      let model = c?.modelName ?? null;
      try {
        const mr = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(6000) });
        const md = await mr.json();
        const found = md?.data?.[0]?.id ?? md?.models?.[0]?.name ?? null;
        if (found) {
          model = found;
          if (c) {
            c.modelName = found;
            save();
          }
        }
      } catch {
        /* the name is a bonus; health is the point */
      }
      return { up: true, status: res.status, model: model ? path.basename(model) : null };
    } catch (e) {
      return { up: false, why: e.message };
    }
  }

  /* ---- probing ---------------------------------------------------- */

  /** Probe an endpoint and report what is actually installed on it. */
  async function probe(id, endpointId) {
    const c = conn(id);
    if (!c) return { ok: false, error: `no connection "${id}"` };
    const ep = endpointId ? c.endpoints.find((e) => e.id === endpointId) : activeFor(c);
    if (!ep) return { ok: false, error: "no endpoint to probe" };

    const paths = { ...DEFAULT_PATHS, ...(c.paths ?? {}) };
    const started = Date.now();

    // One ssh round trip for everything: a probe that opens six connections is
    // six times the latency for the same answer.
    const cmd =
      c.purpose === "model"
        ? [
            "hostname",
            "nproc",
            "free -g | awk '/^Mem:/{print $2}'",
            `df -h ${paths.models} 2>/dev/null | awk 'NR==2{print $4}'`,
            `ls ${paths.models}/*.gguf 2>/dev/null | wc -l`,
            `test -x ${paths.llama}/llama-server && echo llama:yes || echo llama:no`,
            `test -x ${paths.whisper}/whisper-cli && echo whisper:yes || echo whisper:no`,
            `test -f ${paths.whisperModel} && echo speechmodel:yes || echo speechmodel:no`,
            `curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${LLAMA_PORT}/health 2>/dev/null || echo 000`,
          ].join("; ")
        : [
            "hostname",
            "nproc",
            "free -g | awk '/^Mem:/{print $2}'",
            "df -h . | awk 'NR==2{print $4}'",
            // A build engine is useful when it has a filesystem with room and a
            // shell that can run a compiler. That is what is checked.
            "git --version 2>/dev/null | head -1 || echo git:no",
            "command -v make >/dev/null && echo make:yes || echo make:no",
            "command -v gcc >/dev/null && echo gcc:yes || echo gcc:no",
            // The CLI is what makes an AWS box useful to this app; a box that
            // answers ssh but has no aws is reachable and not yet an engine.
            "(aws --version 2>/dev/null | head -1) || echo aws:no",
            "aws sts get-caller-identity --profile anyrealm --output json 2>/dev/null | tr -d '\n' || echo signedout",
            "pwd",
          ].join("; ");

    const r = await sshExec(ep, cmd, 35000);
    const latencyMs = Date.now() - started;
    if (!r.ok) {
      const outcome = { endpointId: ep.id, reachable: false, latencyMs, error: r.error ?? r.stderr.slice(0, 300) };
      ep.lastProbe = { ...outcome, at: Date.now() };
      save();
      return outcome;
    }

    const lines = r.stdout.trim().split("\n");
    const base = {
      endpointId: ep.id,
      reachable: true,
      latencyMs,
      hostname: lines[0] ?? "",
      cores: Number(lines[1]) || null,
      ramGb: Number(lines[2]) || null,
      diskFree: lines[3] ?? null,
      at: Date.now(),
    };

    const outcome =
      c.purpose === "model"
        ? {
            ...base,
            modelCount: Number(lines[4]) || 0,
            llama: (lines[5] ?? "").includes("yes"),
            whisper: (lines[6] ?? "").includes("yes"),
            speechModel: (lines[7] ?? "").includes("yes"),
            serverUp: (lines[8] ?? "").trim() === "200",
          }
        : {
            ...base,
            git: (lines[4] ?? "").replace("git version ", "").trim() || "missing",
            make: (lines[5] ?? "").includes("yes"),
            gcc: (lines[6] ?? "").includes("yes"),
            awsCli: (lines[7] ?? "").includes("aws-cli") ? (lines[7] ?? "").trim() : null,
            // "signed in" is reported as a fact from sts, not inferred from the
            // presence of a config file: a profile with a region and no
            // credentials looks configured and is not.
            awsSignedIn: (() => {
              try {
                const j = JSON.parse(lines[8] ?? "");
                return j?.Account ? { account: j.Account, arn: j.Arn } : false;
              } catch {
                return false;
              }
            })(),
            cwd: lines[9] ?? "",
          };

    ep.lastProbe = outcome;
    save();
    return outcome;
  }

  /* ---- models ----------------------------------------------------- */

  async function listModels(id) {
    const c = conn(id);
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint" };
    const paths = { ...DEFAULT_PATHS, ...(c.paths ?? {}) };
    const r = await sshExec(
      ep,
      `ls -l ${paths.models}/*.gguf 2>/dev/null | awk '{print $5" "$9}'; echo '---'; ` +
        `pgrep -fc 'llama-server -m' 2>/dev/null || echo 0`,
      25000,
    );
    if (!r.ok) return { ok: false, error: r.error };
    const [filesPart, runningPart] = r.stdout.split("---");
    const models = filesPart
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [bytes, full] = line.trim().split(/\s+/, 2);
        return { name: path.basename(full), path: full, bytes: Number(bytes) || 0 };
      });
    return { ok: true, models, dir: paths.models, serverRunning: Number(runningPart?.trim()) > 0, serverPort: LLAMA_PORT };
  }

  async function startServer(id, modelPath) {
    const c = conn(id);
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint" };
    if (c.purpose !== "model") return { ok: false, error: "only the model connection runs a model server" };
    const paths = { ...DEFAULT_PATHS, ...(c.paths ?? {}) };
    const m = modelPath || c.modelName || `${paths.models}/qwen2.5-coder-7b-instruct-q4_k_m.gguf`;
    if (!m.endsWith(".gguf")) return { ok: false, error: `not a .gguf path: ${m}` };
    const cmd =
      `pkill -f 'llama-server -m' >/dev/null 2>&1; sleep 1; ` +
      `cd ${paths.llama} && nohup setsid ./llama-server -m ${m} --host 127.0.0.1 --port ${LLAMA_PORT} ` +
      `-c 8192 -t $(nproc) --jinja --no-webui > ${paths.models}/server.log 2>&1 & sleep 1; echo started`;
    const r = await sshExec(ep, cmd, 30000);
    c.modelName = m;
    save();
    return { ok: r.ok, model: m, detail: r.stdout.trim() || r.error };
  }

  async function stopServer(id) {
    const c = conn(id);
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint" };
    const r = await sshExec(ep, `pkill -f 'llama-server -m' && echo stopped || echo 'nothing running'`, 20000);
    return { ok: r.ok, detail: r.stdout.trim() };
  }

  /** Download a model straight onto the model machine, never through here. */
  async function downloadModel(id, url, name) {
    const c = conn(id);
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint" };
    if (!/^https?:\/\//.test(String(url))) return { ok: false, error: "url must be http(s)" };
    const paths = { ...DEFAULT_PATHS, ...(c.paths ?? {}) };
    const fileName = name && name.endsWith(".gguf") ? name : path.basename(new URL(url).pathname);
    if (!fileName.endsWith(".gguf")) return { ok: false, error: "the file name must end in .gguf" };
    // This becomes a path on another machine; traversal is not a theoretical risk.
    if (fileName.includes("/") || fileName.includes("..")) return { ok: false, error: "invalid file name" };

    const log = `${paths.models}/download-${fileName}.log`;
    const cmd =
      `mkdir -p ${paths.models}; : > ${log}; ` +
      `nohup setsid bash -c 'curl -L --retry 3 --retry-delay 5 -C - "${url}" -o ${paths.models}/${fileName} >> ${log} 2>&1; echo DONE >> ${log}' >/dev/null 2>&1 & echo started`;
    const r = await sshExec(ep, cmd, 20000);
    return { ok: r.ok, fileName, log, detail: r.stdout.trim() || r.error };
  }

  async function downloadProgress(id, fileName) {
    const c = conn(id);
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint" };
    const paths = { ...DEFAULT_PATHS, ...(c.paths ?? {}) };
    const safe = String(fileName).replace(/[^A-Za-z0-9._-]/g, "");
    const r = await sshExec(
      ep,
      `stat -c%s ${paths.models}/${safe} 2>/dev/null || echo 0; echo '---'; tail -c 400 ${paths.models}/download-${safe}.log 2>/dev/null`,
      20000,
    );
    if (!r.ok) return { ok: false, error: r.error };
    const [bytesPart, logPart] = r.stdout.split("---");
    return {
      ok: true,
      fileName: safe,
      bytes: Number(bytesPart.trim()) || 0,
      log: (logPart ?? "").trim(),
      done: (logPart ?? "").includes("DONE"),
    };
  }

  /* ---- speech ----------------------------------------------------- */

  /**
   * Transcribe a WAV on the model machine.
   *
   * WAV only, and the refusal says why: whisper.cpp there reads wav/mp3/ogg/flac
   * but no ffmpeg is installed, so a webm upload would fail deep inside whisper
   * with a message that does not mention the real cause. The browser encodes WAV.
   */
  async function transcribe(id, base64Audio, mime) {
    const c = conn(id);
    const ep = activeFor(c);
    if (!ep) return { ok: false, error: "no active endpoint" };
    const paths = { ...DEFAULT_PATHS, ...(c.paths ?? {}) };
    const audio = Buffer.from(String(base64Audio ?? ""), "base64");
    if (!audio.length) return { ok: false, error: "empty audio" };
    if (audio.length > 25 * 1024 * 1024) return { ok: false, error: "clip is larger than 25 MB; record a shorter one" };
    if (audio.subarray(0, 4).toString("ascii") !== "RIFF" || audio.subarray(8, 12).toString("ascii") !== "WAVE") {
      return {
        ok: false,
        error: `expected a WAV file, got "${mime ?? "unknown"}" — the browser should encode WAV before upload`,
      };
    }

    const remote = `/tmp/anyrealm-voice-${Date.now()}.wav`;
    const local = path.join(workDir, `voice-${Date.now()}.wav`);
    fs.writeFileSync(local, audio);

    const up = await new Promise((resolve) => {
      execFile(
        "scp",
        ["-i", sshKey(), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", local, `${ep.user}@${ep.host}:${remote}`],
        { timeout: 60000 },
        (err, _o, stderr) => resolve({ ok: !err, error: err ? String(stderr || err.message) : null }),
      );
    });
    try {
      fs.unlinkSync(local);
    } catch {
      /* nothing to clean */
    }
    if (!up.ok) return { ok: false, error: `upload failed: ${up.error}` };

    const started = Date.now();
    const r = await sshExec(
      ep,
      `cd ${paths.whisper} && ./whisper-cli -m ${paths.whisperModel} -f ${remote} -nt 2>/dev/null; rm -f ${remote}`,
      120000,
    );
    if (!r.ok) return { ok: false, error: r.error };
    const text = r.stdout
      .split("\n")
      .map((l) => l.replace(/^\[[\d:.\s\->]+\]\s*/, "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    return { ok: true, text, ms: Date.now() - started, bytes: audio.length };
  }

  /* ---- shapes ----------------------------------------------------- */

  /** The public view of one connection, with what is missing from it. */
  function describe(c) {
    const active = activeFor(c);
    return {
      id: c.id,
      purpose: c.purpose,
      label: c.label,
      provider: c.provider ?? "other",
      endpoints: c.endpoints,
      activeId: c.activeId,
      active,
      modelName: c.modelName ? path.basename(c.modelName) : null,
      tunnel: c.tunnel,
      tunnelPort: tunnelPortFor(c.id),
      paths: c.paths,
      nextSteps: !c.endpoints.length
        ? ["add an address for this machine"]
        : !active
          ? ["choose which address is active"]
          : c.purpose === "model" && !c.tunnel?.up
            ? ["open the tunnel so the assistant can reach the model"]
            : [],
    };
  }

  const modelConn = () => state.connections.find((c) => c.purpose === "model") ?? null;

  return {
    PURPOSES,
    state: () => state,
    connections: () => state.connections.map(describe),
    describe,
    conn,
    save,
    probe,
    listModels,
    startServer,
    stopServer,
    downloadModel,
    downloadProgress,
    transcribe,
    openTunnel,
    closeTunnel,
    tunnelHealth,
    wantsTunnel: (id) => conn(id)?.tunnel?.wanted === true,
    /** The OpenAI-compatible base URL for the model machine, if its tunnel is up. */
    providerBase: () => {
      const c = modelConn();
      if (!c || !tunnels.get(c.id)) return null;
      return `http://127.0.0.1:${tunnelPortFor(c.id)}/v1`;
    },
    providerModel: () => {
      const c = modelConn();
      return c?.modelName ? path.basename(c.modelName) : null;
    },
    dispose: () => {
      for (const [id, proc] of tunnels) {
        try {
          proc.kill();
        } catch {
          /* gone */
        }
        tunnels.delete(id);
      }
    },
  };
}
