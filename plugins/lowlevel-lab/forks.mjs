/**
 * Low-level fork registry.
 *
 * The user maintains forks of the low-level tools (EDL, EUD, Hexagon). A fork is
 * only useful if three things stay true, and they decay silently:
 *
 *   1. it still tracks upstream (a fork that stopped merging is a dead branch)
 *   2. it diverges deliberately (a fork with no commits of its own is a mirror)
 *   3. its local checkout matches the fork's branch (local-only edits vanish from
 *      the build and nobody notices until CI produces a different binary)
 *
 * This module records the trio (upstream, fork, local path) and reports those
 * three properties as flags, so a stale fork is visible rather than assumed.
 *
 * Nothing here clones. `git ls-remote` is read-only and cheap; a clone of a
 * multi-hundred-megabyte tool repo is not something a panel should do on render.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";

function git(args, cwd, timeoutMs = 45_000) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

/**
 * Seed registry. The user supplies the real URLs; these are placeholders with
 * the upstream half filled in, because guessing a fork URL would be worse than an
 * empty field.
 */
const SEED = [
  {
    id: "edl",
    transport: "edl",
    label: "EDL client (bkerler)",
    upstream: "https://github.com/bkerler/edl",
    fork: null,
    branch: "main",
    localPath: null,
    purpose: "Sahara + Firehose client with per-vendor loaders; the one that handles the widest set of programmers",
    expects: ["edl.py", "Loaders", "README.md"],
  },
  {
    id: "eud",
    transport: "eud",
    label: "EUD tooling",
    upstream: "",
    fork: null,
    branch: "main",
    localPath: null,
    purpose: "Emergency USB Download; no single canonical open project, so the fork is the reference",
    expects: [],
  },
  {
    id: "qdl",
    transport: "qdl",
    label: "QDL (Linaro)",
    upstream: "https://github.com/linux-msm/qdl",
    fork: null,
    branch: "main",
    localPath: null,
    purpose: "Reference Firehose implementation; small enough to read when a write goes wrong",
    expects: ["qdl.c", "Makefile"],
  },
  {
    id: "hexagon",
    transport: "hexagon",
    label: "Hexagon tools / DSP image work",
    upstream: "",
    fork: null,
    branch: "main",
    localPath: null,
    purpose: "DSP firmware inspection and hexagon target support",
    expects: [],
  },
];

/** Where the registry lives, so a fork assignment survives a restart. */
function registryPath(workDir) {
  return path.join(workDir, "forks.json");
}

export function readRegistry(workDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(workDir), "utf8"));
    if (Array.isArray(raw?.forks)) {
      // Merge by id so a new seed entry appears without losing saved URLs.
      const saved = new Map(raw.forks.map((f) => [String(f.id), f]));
      return SEED.map((s) => ({ ...s, ...(saved.get(s.id) ?? {}) }));
    }
  } catch {
    /* first run */
  }
  return SEED.map((s) => ({ ...s }));
}

export function writeRegistry(workDir, forks) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(registryPath(workDir), JSON.stringify({ version: 1, forks }, null, 2));
}

/** Cheap reachability check: does the remote exist and have this branch? */
async function remoteHasBranch(url, branch) {
  if (!url) return null;
  const r = await git(["ls-remote", "--heads", url, branch]);
  if (!r.ok) return false;
  return r.stdout.trim().length > 0;
}

export async function checkFork(entry) {
  const status = {
    entry,
    upstreamReachable: null,
    forkReachable: null,
    ahead: null,
    behind: null,
    checkout: false,
    checkoutBranch: null,
    dirty: null,
    missingExpected: [],
    warnings: [],
    errors: [],
  };

  // Local checkout first: it is the only source of ahead/behind, and it is the
  // thing that actually feeds a build.
  if (entry.localPath) {
    try {
      if (fs.existsSync(entry.localPath)) {
        const isRepo = await git(["rev-parse", "--is-inside-work-tree"], entry.localPath);
        if (isRepo.ok && isRepo.stdout.trim() === "true") {
          status.checkout = true;

          const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], entry.localPath);
          status.checkoutBranch = branch.ok ? branch.stdout.trim() : null;

          // A dirty tree means the build does not match the fork. That is not
          // always wrong, but it must never be silent.
          const st = await git(["status", "--porcelain"], entry.localPath);
          status.dirty = st.ok ? st.stdout.trim().length > 0 : null;
          if (status.dirty) status.warnings.push("local checkout has uncommitted changes; a build from it will not match the fork");

          const remotes = await git(["remote"], entry.localPath);
          const hasUpstream = remotes.ok && remotes.stdout.split("\n").includes("upstream");
          if (!hasUpstream) {
            status.warnings.push('no "upstream" remote; ahead/behind cannot be computed, so "is this fork current" is unknown');
          } else {
            const target = entry.branch || "HEAD";
            const ab = await git(["rev-list", "--left-right", "--count", `upstream/${target}...HEAD`], entry.localPath);
            if (ab.ok) {
              const [behind, ahead] = ab.stdout.trim().split(/\s+/).map((n) => Number(n));
              status.behind = Number.isFinite(behind) ? behind : null;
              status.ahead = Number.isFinite(ahead) ? ahead : null;
              if (ahead === 0) status.warnings.push("no commits of its own — this fork is a mirror, not a fork");
              if (behind !== null && behind > 0) status.warnings.push(`${behind} commit(s) behind upstream — the fork has stopped tracking`);
            }
          }

          if (status.checkoutBranch && entry.branch && status.checkoutBranch !== entry.branch) {
            status.warnings.push(`checked out ${status.checkoutBranch}, registry says ${entry.branch}`);
          }
        } else {
          status.errors.push(`${entry.localPath} is not a git repository`);
        }
      } else {
        status.errors.push(`local path does not exist: ${entry.localPath}`);
      }
    } catch (e) {
      status.errors.push(`local checkout check failed: ${e.message}`);
    }
  }

  // Remote checks. Skipped when no URL is configured, and reported as null so the
  // UI can distinguish "not checked" from "checked and absent".
  if (entry.upstream) status.upstreamReachable = await remoteHasBranch(entry.upstream, entry.branch || "main");
  if (entry.fork) status.forkReachable = await remoteHasBranch(entry.fork, entry.branch || "main");

  if (entry.upstream && status.upstreamReachable === false) {
    status.warnings.push(`upstream branch "${entry.branch}" not found at ${entry.upstream}`);
  }
  if (entry.fork && status.forkReachable === false) {
    status.errors.push(`fork branch "${entry.branch}" not found at ${entry.fork}`);
  }

  if (entry.localPath && fs.existsSync(entry.localPath)) {
    status.missingExpected = entry.expects.filter((e) => {
      try {
        return !fs.existsSync(path.join(entry.localPath, e));
      } catch {
        return true;
      }
    });
    if (status.missingExpected.length) {
      status.warnings.push(`expected file(s) missing from the checkout: ${status.missingExpected.join(", ")}`);
    }
  }

  return status;
}

/**
 * The remote layout a fork should have for this workflow: `origin` is the user's
 * fork, `upstream` is canonical. Getting these swapped is why `git pull` silently
 * pulls from the fork and never sees upstream fixes.
 */
export function remoteRecipe(entry) {
  const lines = ["# Re-point the remotes so origin is the fork and upstream is canonical."];
  if (entry.fork) {
    lines.push(`git remote set-url origin ${entry.fork}`);
    lines.push(`git remote add upstream ${entry.upstream || "<upstream-url>"} 2>/dev/null || git remote set-url upstream ${entry.upstream || "<upstream-url>"}`);
    lines.push(`git fetch --all --prune`);
    lines.push(`git checkout ${entry.branch || "main"}`);
    lines.push(`git merge --ff-only upstream/${entry.branch || "main"}`);
  } else {
    lines.push(`git remote add upstream ${entry.upstream || "<upstream-url>"} 2>/dev/null || git remote set-url upstream ${entry.upstream || "<upstream-url>"}`);
    lines.push(`git fetch upstream --prune`);
  }
  return lines;
}
