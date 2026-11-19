/**
 * Compile routing: where a build actually runs.
 *
 * The builder has three genuinely different execution sites, and they are not
 * interchangeable:
 *
 *   local     This machine. Fastest to start, no network, but a kernel build
 *             saturates every core and the image is stuck here afterwards.
 *   actions   GitHub Actions on a self-hosted runner. Reproducible and logged,
 *             but a queued job waits for a runner that may be busy or asleep.
 *   remote    A box you control over SSH — the Azure VM, a VPS, an instance.
 *
 * A remote is deliberately NOT one address. The same machine answers on a LAN
 * address, a public address, a tunnel, sometimes a second port — and which of
 * those is reachable changes when you move between networks. So a remote holds a
 * *pool* of endpoints and names one as active. Swapping the address you build
 * through is a one-field edit, not a re-created runner, and probing the pool
 * tells you which address currently works.
 *
 * Every probe here is read-only. Nothing in this module starts a build.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";

export type TargetKind = "local" | "actions" | "remote";

/** One way of reaching a remote host. */
export interface RemoteEndpoint {
  id: string;
  /** Where this address works, e.g. "lan", "public", "tailscale". */
  label: string;
  user: string;
  host: string;
  port: number;
  /** Key path. Empty means the SSH agent or a default key. */
  identity?: string;
}

export interface Runner {
  id: string;
  /** Human label shown in the picker. */
  label: string;
  kind: TargetKind;
  /**
   * For actions: the repository the workflow lives in (owner/repo).
   * For remote: kept for display only — the truth is the endpoint pool.
   */
  host: string;
  /** Remote: the pool of addresses this box answers on. */
  endpoints?: RemoteEndpoint[];
  /** Remote: which endpoint is currently active. */
  endpointId?: string | null;
  /** For remote: where builds land on that host. */
  workDir: string;
  /** For actions: label set the runner must carry, e.g. anyrealm-vm. */
  labels?: string[];
  /** Notes the user wants to remember, e.g. "Standard_E4ds_v4". */
  notes?: string;
  /** Cores/RAM as the user stated them, for a rough sanity check. */
  cores?: number;
  ramGb?: number;
}

/** Last probe outcome per endpoint, so a known-dead address warns before dispatch. */
export interface ProbeRecord {
  reachable: boolean;
  latencyMs: number | null;
  at: string;
  error?: string;
}

export interface CompileRoute {
  target: TargetKind;
  runnerId: string | null;
  structure?: string;
  reason?: string;
  updatedAt?: string;
}

export interface RunnerProbe {
  runnerId: string;
  /** Which endpoint was probed; "local"/"actions" for the other sites. */
  endpointId: string | null;
  label: string;
  reachable: boolean;
  latencyMs: number | null;
  facts: string[];
  error?: string;
  /** Which command was used, so a failure is reproducible by hand. */
  command: string;
}

function statePath(workDir: string) {
  return path.join(workDir, "compile-routing.json");
}

/**
 * A route that applies to the next builds and then expires.
 *
 * The normal route is a standing decision. But often you want to send one build
 * through a machine that is up *right now* — a VM you just booted, a box on
 * this LAN — without rewriting where builds normally go. A temporary route
 * carries its own deadline and the route to fall back to, so forgetting to
 * revert cannot strand every later build on a host that has gone away.
 */
export interface TemporaryRoute {
  route: CompileRoute;
  /** When this stops applying. */
  expiresAt: string;
  /** The standing route to restore — captured at creation. */
  fallback: CompileRoute;
  note?: string;
}

export interface RoutingState {
  runners: Runner[];
  route: CompileRoute;
  /** Keyed `${runnerId}::${endpointId}`. Absent means never probed. */
  probes?: Record<string, ProbeRecord>;
  /** Applies over `route` until it expires. */
  temporary?: TemporaryRoute | null;
}

/** Is the temporary route still in force at `now`? */
export function temporaryActive(t: TemporaryRoute | null | undefined, now = Date.now()): boolean {
  if (!t) return false;
  const end = Date.parse(t.expiresAt);
  return Number.isFinite(end) && end > now;
}

/** The route a dispatch would actually use. */
export function effectiveRoute(state: RoutingState, now = Date.now()): CompileRoute & { temporary: boolean; expiresAt?: string } {
  if (temporaryActive(state.temporary, now)) {
    return { ...state.temporary!.route, temporary: true, expiresAt: state.temporary!.expiresAt };
  }
  return { ...state.route, temporary: false };
}

export function readState(workDir: string): RoutingState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(workDir), "utf8"));
    if (Array.isArray(raw?.runners) && raw?.route) {
      return {
        runners: raw.runners.map(migrateRunner),
        route: raw.route,
        probes: raw.probes ?? {},
        // Dropping this on read made a temporary route vanish on the next write.
        temporary: raw.temporary ?? null,
      };
    }
  } catch {
    /* first run */
  }
  return { runners: [], route: { target: "local", runnerId: null }, probes: {}, temporary: null };
}

/**
 * A runner saved before the endpoint pool existed has a bare `host` of the form
 * user@host. Turn that into a one-entry pool rather than discarding it — losing a
 * configured host on upgrade is worse than a slightly odd label.
 */
function migrateRunner(r: Runner): Runner {
  if (r.kind !== "remote") return r;
  if (Array.isArray(r.endpoints) && r.endpoints.length) return r;
  const m = /^(?:ssh:\/\/)?([^@\s]+)@([^:\s]+)(?::(\d+))?$/.exec(String(r.host ?? "").trim());
  if (!m) return { ...r, endpoints: [], endpointId: null };
  const ep: RemoteEndpoint = {
    id: "default",
    label: "saved address",
    user: m[1],
    host: m[2],
    port: m[3] ? Number(m[3]) : 22,
    identity: r["identity" as keyof Runner] as string | undefined,
  };
  return { ...r, endpoints: [ep], endpointId: ep.id };
}

export function writeState(workDir: string, state: RoutingState) {
  fs.mkdirSync(workDir, { recursive: true });
  const p = statePath(workDir);
  fs.writeFileSync(p + ".tmp", JSON.stringify({ version: 2, ...state }, null, 2));
  fs.renameSync(p + ".tmp", p);
}

/** The endpoint a remote currently builds through, or null if none is set. */
export function activeEndpoint(r: Runner): RemoteEndpoint | null {
  if (r.kind !== "remote") return null;
  const pool = r.endpoints ?? [];
  if (!pool.length) return null;
  return pool.find((e) => e.id === r.endpointId) ?? pool[0];
}

/** Validate one endpoint coming from the API. Returns the reason it is unusable. */
export function endpointProblem(e: Partial<RemoteEndpoint>): string | null {
  if (!String(e.user ?? "").trim()) return "user is required (the part before @)";
  const host = String(e.host ?? "").trim();
  if (!host) return "host is required (an IP or a DNS name)";
  if (host.includes("@")) return "host must not include the user; put it in the user field";
  if (host.includes("/") || /\s/.test(host)) return "host must be a bare IP or DNS name";
  const port = Number(e.port ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "port must be an integer 1-65535";
  return null;
}

/**
 * Probe one remote endpoint over SSH.
 *
 * One command, four facts: does SSH work at all, how long it took, what the host
 * is, and is the work directory there. `BatchMode=yes` matters — without it a key
 * prompt hangs the HTTP request until the socket timeout, which reads as "the
 * server is broken" rather than "this address needs a different key".
 */
export function probeRemote(
  runner: Runner,
  endpoint: RemoteEndpoint,
  workDirOverride?: string,
): Promise<RunnerProbe> {
  const workDir = workDirOverride ?? runner.workDir ?? "";
  const port = endpoint.port ?? 22;
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=8",
    "-p",
    String(port),
  ];
  if (endpoint.identity) args.push("-i", endpoint.identity);
  // -i also has to survive on the display copy of the command below.

  const script = [
    `echo "host=$(hostname)"`,
    `echo "kernel=$(uname -r)"`,
    `echo "cores=$(nproc)"`,
    // int() rather than printf: no nested quoting to get wrong over SSH.
    `echo "mem_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"`,
    `echo "disk=$(df -Pk ${shellQuote(workDir || "/")} 2>/dev/null | awk 'NR==2{print $4}')"`,
    `test -d ${shellQuote(workDir || "/")} && echo "workdir=yes" || echo "workdir=no"`,
  ].join("; ");

  const target = `${endpoint.user}@${endpoint.host}`;
  const command = `ssh ${args.join(" ")} ${target} '<probe>'`;
  args.push(target, script);

  return new Promise((resolve) => {
    const started = Date.now();
    execFile("ssh", args, { timeout: 25_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const latencyMs = Date.now() - started;
      const base = { runnerId: runner.id, endpointId: endpoint.id, label: endpoint.label, command };
      if (err) {
        resolve({
          ...base,
          reachable: false,
          latencyMs: null,
          facts: [],
          error: (stderr || err.message || "").trim() || `ssh exited ${(err as any).code}`,
        });
        return;
      }
      const facts: string[] = [];
      for (const line of stdout.split("\n")) {
        const [k, v] = line.split("=");
        if (!k || v === undefined) continue;
        if (k === "disk") {
          const kb = Number(v);
          if (Number.isFinite(kb)) facts.push(`disk free ${(kb / 1024 / 1024).toFixed(1)} GiB in ${workDir || "/"}`);
        } else if (k === "mem_mb") {
          facts.push(`ram ${(Number(v) / 1024).toFixed(1)} GiB`);
        } else if (k === "workdir") {
          facts.push(v === "yes" ? "work dir exists" : "WORK DIR MISSING");
        } else {
          facts.push(`${k} ${v}`);
        }
      }
      resolve({ ...base, reachable: true, latencyMs, facts });
    });
  });
}

/**
 * Probe an Actions route.
 *
 * `gh` is used rather than the REST API because it is already authenticated on
 * any machine that can dispatch a workflow. If it is absent the probe says so
 * instead of claiming the runner is missing.
 */
export function probeActions(runner: Runner): Promise<RunnerProbe> {
  const labels = (runner.labels ?? []).join(",");
  const args = [
    "api",
    `repos/${runner.host}/actions/runners`,
    "--jq",
    ".runners[] | {name,status,busy,labels:[.labels[].name]}",
  ];
  const command = `gh ${args.join(" ")}`;
  const base = { runnerId: runner.id, endpointId: null, label: "actions", command };

  return new Promise((resolve) => {
    const started = Date.now();
    execFile("gh", args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ...base,
          reachable: false,
          latencyMs: null,
          facts: [],
          error: (stderr || err.message || "").trim() || "gh failed",
        });
        return;
      }
      const latencyMs = Date.now() - started;
      const facts: string[] = [];
      let matched = 0;
      for (const line of stdout.trim().split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          const wanted = runner.labels ?? [];
          const has = wanted.length ? wanted.every((l) => (r.labels ?? []).includes(l)) : true;
          if (has) {
            matched++;
            facts.push(`${r.name}: ${r.status}${r.busy ? ", busy" : ", idle"}`);
          }
        } catch {
          /* skip unparsable line */
        }
      }
      if (matched === 0) facts.push(`no runner carries the label(s) ${labels || "(none)"}`);
      resolve({ ...base, reachable: true, latencyMs, facts });
    });
  });
}

/** The local machine, described from what this process can see. */
export function probeLocal(): RunnerProbe {
  const facts = [
    `host ${os.hostname()}`,
    `kernel ${os.release()}`,
    `cores ${os.cpus().length}`,
    `ram ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
  ];
  try {
    const st = fs.statfsSync(process.cwd());
    facts.push(`disk free ${((st.bavail * st.bsize) / 1024 ** 3).toFixed(1)} GiB here`);
  } catch {
    /* statfs unsupported */
  }
  return { runnerId: "local", endpointId: null, label: "local", reachable: true, latencyMs: 0, facts, command: "(in-process)" };
}

function shellQuote(s: string) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Why a route is a bad idea, stated as a consequence rather than a rule.
 * Returned to the UI so the picker can warn before a 4-hour build lands badly.
 */
export function routeWarnings(
  route: CompileRoute,
  runners: Runner[],
  probes?: Record<string, ProbeRecord>,
): string[] {
  const out: string[] = [];
  const runner = route.runnerId ? runners.find((r) => r.id === route.runnerId) : null;

  if (route.target !== "local" && !runner) {
    out.push(`${route.target} needs a runner, and none is assigned — the build has nowhere to go`);
  }
  if (route.target === "local" && runner) {
    out.push("a runner is assigned but the route is local; the runner will be ignored");
  }

  if (runner?.kind === "remote") {
    const ep = activeEndpoint(runner);
    if (!ep) {
      out.push("this remote has no address assigned — add an endpoint before dispatching");
    } else {
      if (ep.host === "127.0.0.1" || ep.host === "localhost") {
        out.push("the active endpoint is loopback; that only works if the build host is this machine");
      }
      if (!ep.identity) out.push("the active endpoint has no identity file; the probe relies on the SSH agent or a default key");
      if ((runner.endpoints ?? []).length === 1) {
        out.push("only one endpoint in the pool — if that address changes, dispatching fails until you edit it");
      }
      // A remembered failure is stronger evidence than a configured address.
      const rec = probes?.[`${runner.id}::${ep.id}`];
      if (rec && !rec.reachable) {
        out.push(`the active address ${ep.user}@${ep.host}:${ep.port} failed its last probe (${new Date(rec.at).toLocaleString()}) — dispatch will fail too`);
      }
      if (!rec) {
        out.push("the active address has never been probed — reachability is assumed, not checked");
      }
    }
  }

  if (runner) {
    if (runner.kind === "remote" && (runner.cores ?? 0) > 0 && (runner.cores ?? 0) < 4) {
      out.push(
        `${runner.cores} core(s): a 6.12 kernel with all modules takes hours and the tree may not fit; ` +
          "4 vCPU is the practical floor for this build",
      );
    }
    if (runner.kind === "remote" && (runner.ramGb ?? 0) > 0 && (runner.ramGb ?? 0) < 8) {
      out.push(`${runner.ramGb} GiB RAM: -j with many jobs will hit the OOM killer rather than fail cleanly`);
    }
    if (runner.kind === "actions" && !(runner.labels ?? []).length) {
      out.push("no labels: GitHub will match any self-hosted runner, including one on a different machine");
    }
  }

  return out;
}

/** A display string for the active address, used in lists and logs. */
export function endpointSummary(r: Runner): string {
  const ep = activeEndpoint(r);
  if (!ep) return "(no address)";
  return `${ep.user}@${ep.host}:${ep.port}`;
}
