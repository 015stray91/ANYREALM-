/**
 * Upstream source sync.
 *
 * The sources catalog is not a list of notes -- it is a set of live remotes.
 * This module keeps the builder pointed at whatever those remotes currently
 * say, so a build never starts from a stale copy.
 *
 * Two levels, deliberately separate because they cost very different amounts:
 *
 *   probe()  cheap. `git ls-remote` only. Tells you the default branch and the
 *            commit each remote is on right now, without downloading a repo.
 *            Safe to run for every catalog entry on page load.
 *
 *   sync()   expensive. Maintains a bare mirror under the mirror root, then
 *            `git remote update` to fast-forward it. --filter=blob:none keeps
 *            AOSP-sized trees from filling the disk, since a build only needs
 *            the blobs it checks out.
 *
 * Mirrors live outside the workspace by default (/tmp/anyrealm-sources) on
 * purpose: they are disposable caches, and a 250 GB AOSP tree must never end up
 * in a saved project.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";

export interface CatalogSource {
  id: string;
  name: string;
  kind: "rom" | "rom_x86" | "mobile_linux" | "desktop_linux" | "kernel" | "desktop_env";
  url: string;
  license?: string;
  arch?: string[];
  note?: string;
  build_hint?: string;
  install?: string;
  /** True for a distributed artifact (an ISO), not a git source tree. */
  prebuilt?: boolean;
}

export interface ProbeResult {
  id: string;
  name: string;
  url: string;
  kind: string;
  reachable: boolean;
  defaultBranch?: string;
  headSha?: string;
  headSubject?: string;
  branches?: number;
  tags?: number;
  error?: string;
  checkedAt: string;
  latencyMs: number;
}

export interface MirrorState {
  id: string;
  url: string;
  mirrorPath: string;
  headSha?: string;
  defaultBranch?: string;
  fetchedAt?: string;
  bytes?: number;
  error?: string;
}

export interface SyncResult {
  id: string;
  ok: boolean;
  action: "cloned" | "updated" | "unchanged" | "failed";
  headSha?: string;
  headSubject?: string;
  defaultBranch?: string;
  mirrorPath?: string;
  bytes?: number;
  log?: string[];
  error?: string;
  durationMs: number;
}

const MIRROR_ROOT =
  process.env.ANYREALM_MIRROR_ROOT || path.join(require("os").tmpdir(), "anyrealm-sources");

export function mirrorRoot(): string {
  return MIRROR_ROOT;
}

function git(args: string[], opts: { timeout?: number; cwd?: string } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 60_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          // Never block a headless build host on a credential prompt.
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "/bin/true",
          GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
        },
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      },
    );
  });
}

/** Cheap remote inspection. No download, no disk use. */
export async function probe(src: CatalogSource, timeoutMs = 30_000): Promise<ProbeResult> {
  const started = Date.now();
  // A prebuilt artifact is not a git remote. Probing it with ls-remote would
  // report a false "unreachable", so check the page is served instead.
  if (src.prebuilt) {
    const base: ProbeResult = {
      id: src.id, name: src.name, url: src.url, kind: src.kind,
      reachable: false, checkedAt: new Date().toISOString(), latencyMs: 0,
    };
    try {
      const res = await fetch(src.url, { method: "HEAD", redirect: "follow" });
      base.reachable = res.ok;
      if (!res.ok) base.error = `artifact page returned ${res.status}`;
    } catch (e: any) {
      base.error = e?.message ?? "artifact page unreachable";
    }
    base.latencyMs = Date.now() - started;
    base.defaultBranch = "prebuilt";
    return base;
  }
  const base: ProbeResult = {
    id: src.id,
    name: src.name,
    url: src.url,
    kind: src.kind,
    reachable: false,
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
  };

  // ls-remote --symref gives HEAD and the branch it points at in one call.
  const r = await git(["ls-remote", "--symref", src.url, "HEAD", "refs/heads/*", "refs/tags/*"], {
    timeout: timeoutMs,
  });

  base.latencyMs = Date.now() - started;
  if (r.code !== 0) {
    base.error = (r.stderr || "git ls-remote failed").trim().split("\n").slice(-3).join(" | ");
    return base;
  }

  let defaultBranch: string | undefined;
  let headSha: string | undefined;
  let branches = 0;
  let tags = 0;

  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("ref: ")) {
      // "ref: refs/heads/main\tHEAD"
      const m = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
      if (m) defaultBranch = m[1];
      continue;
    }
    const [sha, ref] = line.split("\t");
    if (!ref) continue;
    if (ref.startsWith("refs/heads/")) branches++;
    else if (ref.startsWith("refs/tags/")) tags++;
    if (ref === "HEAD") headSha = sha;
  }

  // Some servers omit the symref line; fall back to the usual names.
  if (!defaultBranch) {
    for (const cand of ["main", "master", "dev", "lineage-21.0"]) {
      if (r.stdout.includes(`refs/heads/${cand}`)) {
        defaultBranch = cand;
        break;
      }
    }
  }

  base.reachable = !!headSha;
  base.defaultBranch = defaultBranch;
  base.headSha = headSha;
  base.branches = branches;
  base.tags = tags;
  return base;
}

/** Probe many sources with bounded concurrency, so one slow remote cannot stall the list. */
export async function probeAll(sources: CatalogSource[], concurrency = 6): Promise<ProbeResult[]> {
  const out: ProbeResult[] = new Array(sources.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= sources.length) return;
      out[i] = await probe(sources[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function mirrorPathFor(src: CatalogSource): string {
  const safe = src.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(MIRROR_ROOT, `${safe}.git`);
}

function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(abs);
        else total += fs.statSync(abs).size;
      } catch {
        /* races with git's own writes are expected */
      }
    }
  }
  return total;
}

/**
 * Create or fast-forward the bare mirror for one source.
 *
 * --filter=blob:none makes this a partial clone: the object database holds
 * commits and trees but fetches blobs on demand. For a ROM tree that is the
 * difference between a few hundred MB and a few hundred GB.
 */
export async function sync(
  src: CatalogSource,
  opts: { timeoutMs?: number; fullBlobs?: boolean } = {},
): Promise<SyncResult> {
  const started = Date.now();
  if (src.prebuilt) {
    return {
      id: src.id, ok: false, action: "failed", durationMs: 0,
      error: `${src.name} is a prebuilt artifact, not a git source tree -- download it rather than mirroring it`,
    };
  }
  const mirror = mirrorPathFor(src);
  const log: string[] = [];
  fs.mkdirSync(MIRROR_ROOT, { recursive: true });
  const timeout = opts.timeoutMs ?? 15 * 60_000;

  const exists = fs.existsSync(path.join(mirror, "HEAD"));

  if (!exists) {
    log.push(`cloning ${src.url} -> ${mirror}`);
    fs.rmSync(mirror, { recursive: true, force: true });
    const args = ["clone", "--mirror", "--no-single-branch"];
    if (!opts.fullBlobs) args.push("--filter=blob:none");
    args.push(src.url, mirror);
    const r = await git(args, { timeout });
    log.push(...r.stderr.trim().split("\n").filter(Boolean).slice(-6));
    if (r.code !== 0) {
      return {
        id: src.id,
        ok: false,
        action: "failed",
        error: (r.stderr || "clone failed").trim().split("\n").slice(-3).join(" | "),
        log,
        durationMs: Date.now() - started,
      };
    }
  }

  const before = (await git(["-C", mirror, "rev-parse", "HEAD"], { timeout: 30_000 })).stdout.trim();

  log.push("fetching updates (git remote update --prune)");
  const up = await git(["-C", mirror, "remote", "update", "--prune"], { timeout });
  log.push(...up.stderr.trim().split("\n").filter(Boolean).slice(-8));
  if (up.code !== 0) {
    return {
      id: src.id,
      ok: false,
      action: "failed",
      error: (up.stderr || "fetch failed").trim().split("\n").slice(-3).join(" | "),
      mirrorPath: mirror,
      log,
      durationMs: Date.now() - started,
    };
  }

  const after = (await git(["-C", mirror, "rev-parse", "HEAD"], { timeout: 30_000 })).stdout.trim();
  const branchRef = (await git(["-C", mirror, "symbolic-ref", "--short", "HEAD"], { timeout: 15_000 })).stdout.trim();
  const subject = (await git(["-C", mirror, "log", "-1", "--pretty=%s", "HEAD"], { timeout: 15_000 })).stdout.trim();

  return {
    id: src.id,
    ok: true,
    action: !exists ? "cloned" : before === after ? "unchanged" : "updated",
    headSha: after,
    headSubject: subject,
    defaultBranch: branchRef || undefined,
    mirrorPath: mirror,
    bytes: dirSize(mirror),
    log,
    durationMs: Date.now() - started,
  };
}

/** Read back what the mirrors on disk currently hold, without touching the network. */
export async function mirrorState(src: CatalogSource): Promise<MirrorState> {
  const mirror = mirrorPathFor(src);
  const state: MirrorState = { id: src.id, url: src.url, mirrorPath: mirror };
  if (!fs.existsSync(path.join(mirror, "HEAD"))) return state;
  const head = await git(["-C", mirror, "rev-parse", "HEAD"], { timeout: 15_000 });
  if (head.code === 0) state.headSha = head.stdout.trim();
  const br = await git(["-C", mirror, "symbolic-ref", "--short", "HEAD"], { timeout: 15_000 });
  if (br.code === 0) state.defaultBranch = br.stdout.trim();
  try {
    state.fetchedAt = fs.statSync(path.join(mirror, "HEAD")).mtime.toISOString();
  } catch {
    /* ignore */
  }
  state.bytes = dirSize(mirror);
  return state;
}

/** Human-readable drift between a live probe and the local mirror. */
export function freshness(p: ProbeResult, m: MirrorState): {
  status: "not-mirrored" | "current" | "behind" | "unreachable";
  detail: string;
} {
  if (!p.reachable) return { status: "unreachable", detail: p.error ?? "remote unreachable" };
  if (!m.headSha) return { status: "not-mirrored", detail: "no local mirror yet" };
  if (p.headSha && p.headSha === m.headSha) {
    return { status: "current", detail: `at ${p.headSha.slice(0, 10)} on ${p.defaultBranch ?? "HEAD"}` };
  }
  if (p.headSha) {
    return {
      status: "behind",
      detail: `upstream ${p.headSha.slice(0, 10)} vs local ${m.headSha.slice(0, 10)}`,
    };
  }
  return { status: "current", detail: "remote has no HEAD" };
}

/**
 * Load the catalog. Desktop-environment addons live in their own section
 * because they are not distros and cannot produce a bootable image on their
 * own, but they are still valid remotes to track and merge.
 */
export function loadCatalog(file: string, includeAddons = false): CatalogSource[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const base = (raw.sources ?? []) as CatalogSource[];
  if (!includeAddons) return base;
  return [...base, ...((raw.addons ?? []) as CatalogSource[])];
}
