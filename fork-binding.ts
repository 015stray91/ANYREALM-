/**
 * Fork binding.
 *
 * A fork must build on the fork owner's account, against the fork owner's repo,
 * and it may not dispatch anything until the builder has composed a spec there.
 * That last rule is the important one: the builder GUI is the only path that
 * produces a valid workflow file, so a fresh fork has nothing to run until
 * someone has gone through it on that fork.
 *
 * This module holds the state and the rules. Nothing here talks to GitHub --
 * dispatch does, in server.ts -- so the rules can be tested without a token.
 */

import fs from "fs";
import path from "path";

export interface RepoTarget {
  owner: string;
  repo: string;
  /** Branch the workflow must exist on for a dispatch to succeed. */
  ref?: string;
}

export interface ForkBinding {
  /** Stable key: "owner/repo". */
  key: string;
  owner: string;
  repo: string;
  ref: string;
  /** True once the builder has composed and committed a workflow here. */
  composed: boolean;
  composedAt?: string;
  /** Workflow file the builder wrote, relative to .github/workflows/. */
  workflowFile?: string;
  edition?: string;
  /** Upstream this fork descends from, for attribution in the UI. */
  forkedFrom?: string;
  lastDispatch?: {
    at: string;
    runId?: number;
    runUrl?: string;
    ok: boolean;
    detail?: string;
  };
}

const STATE_FILE =
  process.env.ANYREALM_FORK_STATE || path.join(process.cwd(), ".anyrealm-forks.json");

function loadAll(): Record<string, ForkBinding> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {
    /* a corrupt state file must not take the server down */
  }
  return {};
}

function saveAll(all: Record<string, ForkBinding>): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2) + "\n");
}

export function keyOf(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

export class ForkError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Validate an owner/repo pair before it ever reaches an API call. */
export function validateTarget(t: Partial<RepoTarget>): RepoTarget {
  const owner = (t.owner ?? "").trim();
  const repo = (t.repo ?? "").trim();
  const ref = (t.ref ?? "").trim() || "main";

  // GitHub's own rules: alphanumerics and single hyphens for owners; repos can
  // also carry dot, underscore. Rejecting here means a typo becomes a clear
  // message instead of a 404 from the API.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    throw new ForkError(`invalid owner "${owner}" -- GitHub owners are alphanumerics and single hyphens`);
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new ForkError(`invalid repo "${repo}"`);
  }
  if (!/^[A-Za-z0-9._\/-]{1,255}$/.test(ref)) {
    throw new ForkError(`invalid ref "${ref}"`);
  }
  return { owner, repo, ref };
}

export function getBinding(owner: string, repo: string): ForkBinding | null {
  return loadAll()[keyOf(owner, repo)] ?? null;
}

export function listBindings(): ForkBinding[] {
  return Object.values(loadAll()).sort((a, b) => a.key.localeCompare(b.key));
}

/** Record that the builder composed a workflow for this fork. */
export function markComposed(
  owner: string,
  repo: string,
  opts: {
    ref?: string;
    workflowFile: string;
    edition?: string;
    forkedFrom?: string;
  },
): ForkBinding {
  const t = validateTarget({ owner, repo, ref: opts.ref });
  if (!opts.workflowFile || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(opts.workflowFile)) {
    throw new ForkError(`workflowFile must be a .yml/.yaml file name, got "${opts.workflowFile}"`);
  }
  const all = loadAll();
  const key = keyOf(t.owner, t.repo);
  const prev = all[key];
  const next: ForkBinding = {
    ...(prev ?? {}),
    key,
    owner: t.owner,
    repo: t.repo,
    ref: t.ref!,
    composed: true,
    composedAt: new Date().toISOString(),
    workflowFile: opts.workflowFile,
    edition: opts.edition ?? prev?.edition,
    forkedFrom: opts.forkedFrom ?? prev?.forkedFrom,
  };
  all[key] = next;
  saveAll(all);
  return next;
}

export function recordDispatch(
  owner: string,
  repo: string,
  d: { ok: boolean; runId?: number; runUrl?: string; detail?: string },
): void {
  const all = loadAll();
  const key = keyOf(owner, repo);
  const b = all[key];
  if (!b) return;
  b.lastDispatch = { at: new Date().toISOString(), ...d };
  saveAll(all);
}

/**
 * The gate. Returns a refusal reason, or null when a dispatch is allowed.
 *
 * Deliberately strict: no binding means the fork has not been through the
 * builder, and a fork that has not been through the builder has no workflow
 * file to run -- so pretending to dispatch would only produce a confusing 404.
 */
export function dispatchRefusal(owner: string, repo: string, workflowFile?: string): string | null {
  const b = getBinding(owner, repo);
  if (!b) {
    return `${owner}/${repo} has not been composed in the builder yet. Run the builder against this fork first: it writes the workflow file and only then can it be dispatched.`;
  }
  if (!b.composed) {
    return `${owner}/${repo} is registered but no workflow has been composed for it.`;
  }
  if (workflowFile && b.workflowFile && workflowFile !== b.workflowFile) {
    return `this fork was composed with ${b.workflowFile}, not ${workflowFile}. Re-compose in the builder to change it.`;
  }
  return null;
}
