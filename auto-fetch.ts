/**
 * Auto-fetch: after a dispatched build succeeds, pull the artefact down without
 * the user going to the Actions page.
 *
 * The pattern is the one ABK uses, and it is the right one for a local front end:
 * dispatch, remember the run id, poll the run until it reaches a conclusion, then
 * list that run's artefacts and download the one the edition produces. The polling
 * and the download both live here rather than in either shell, because there are
 * two shells (desktop and APK) and a second copy would drift.
 *
 * Two things this must not do:
 *
 *   - it must not poll forever. A build can sit queued behind other jobs for a
 *     long time, so the budget is generous but finite, and hitting it reports a
 *     timeout rather than silently stopping.
 *   - it must not report success on a run that completed with a failure. "completed"
 *     and "succeeded" are different words and GitHub uses both; conflating them is
 *     how a front end claims an artefact that was never uploaded.
 */

import fs from "fs";
import path from "path";

export type RunStatus = "queued" | "in_progress" | "completed" | "unknown";

export interface DispatchWatch {
  owner: string;
  repo: string;
  /** Workflow file name, for display and for re-dispatch. */
  workflow: string;
  edition: string;
  /** Run id, once GitHub has answered with one. */
  runId?: number;
  /** ISO timestamps so a UI can show how long a build has been going. */
  startedAt: string;
  lastPollAt?: string;
  status: RunStatus;
  conclusion?: string;
  /** 0..100, from the job step list when it is available. */
  progress: number;
  /** Artefacts found for this run, once it has completed successfully. */
  artifacts: Array<{ id: number; name: string; sizeBytes: number }>;
  /** Local file path once a download finished. */
  downloadedTo?: string;
  /** Why the watch stopped, when it stopped for a reason. */
  error?: string;
  /** Poll count, so a user can tell "waiting" from "stuck". */
  polls: number;
}

/** What artefact name each edition should produce. */
export const EDITION_ARTIFACTS: Record<string, RegExp> = {
  desktop_iso: /(\.iso$|\biso\b)/i,
  mobile_kernel: /(\.zip$|anykernel|kernel)/i,
  rom: /(\.zip$|\brom\b)/i,
};

/**
 * Turn a run's status into a progress percentage.
 *
 * GitHub's run status only offers queued / in_progress / completed, which is too
 * coarse to be useful, so when the job list is available the completed-step ratio
 * is used instead. A queued run reports 0 rather than a misleading 1.
 */
export function progressFromJobs(
  status: RunStatus,
  steps: Array<{ status: string; conclusion?: string | null }>,
): number {
  if (status === "completed") return 100;
  if (status !== "in_progress" || steps.length === 0) return 0;
  const done = steps.filter((s) => s.status === "completed").length;
  // Cap at 99 while in progress: 100 is reserved for an actual completion, so a
  // UI never shows a finished bar for a run that has not finished.
  return Math.min(99, Math.round((done / steps.length) * 100));
}

/** Pick the artefact that belongs to an edition. */
export function chooseArtifact(
  edition: string,
  artifacts: Array<{ id: number; name: string; sizeBytes: number }>,
): { id: number; name: string; sizeBytes: number } | null {
  if (artifacts.length === 0) return null;
  const pattern = EDITION_ARTIFACTS[edition];
  if (pattern) {
    const hit = artifacts.find((a) => pattern.test(a.name));
    if (hit) return hit;
  }
  // Fall back to the largest artefact: a build's real output is almost always the
  // biggest thing it uploaded, and a zip of logs never is.
  return [...artifacts].sort((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null;
}

/**
 * Default place to put a fetched artefact.
 *
 * Not the working directory: a packaged app's cwd is the launcher's, and writing
 * an ISO next to a binary inside an AppImage mount would fail. `~/.anyrealm/artifacts`
 * is stable across both shells and survives an app update.
 */
export function artifactDir(home = process.env.HOME || "/tmp"): string {
  const dir = path.join(home, ".anyrealm", "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A file name that will not overwrite a previous fetch of the same artefact. */
export function uniquePath(dir: string, name: string): string {
  const base = path.basename(name);
  let candidate = path.join(dir, base);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    candidate = path.join(dir, `${stem}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

/** The polling budget: 15 s between polls, 80 polls ≈ 20 minutes. */
export const POLL_INTERVAL_MS = 15_000;
export const MAX_POLLS = 80;

/**
 * Decide whether a watch should keep polling.
 *
 * Separated from the loop so the stopping rules are testable without a network:
 * completed stops, a budget overrun stops, and anything else continues.
 */
export function shouldKeepPolling(w: DispatchWatch): { keep: boolean; reason?: string } {
  if (w.status === "completed") return { keep: false, reason: "completed" };
  if (w.error) return { keep: false, reason: "error" };
  if (w.polls >= MAX_POLLS) {
    return {
      keep: false,
      reason:
        `gave up after ${MAX_POLLS} polls (~${Math.round((MAX_POLLS * POLL_INTERVAL_MS) / 60000)} min). ` +
        `The build may still be queued or running; open the run to check.`,
    };
  }
  return { keep: true };
}

/**
 * Whether a completed run deserves a download.
 *
 * A run that concluded `failure`, `cancelled` or `timed_out` completed, and a front
 * end that treats "completed" as success will try to fetch an artefact that does
 * not exist and report a confusing 404 instead of the real reason.
 */
export function fetchDecision(w: DispatchWatch): {
  fetch: boolean;
  reason: string;
} {
  if (w.status !== "completed") return { fetch: false, reason: "still running" };
  if (w.conclusion !== "success") {
    return {
      fetch: false,
      reason: `run concluded "${w.conclusion ?? "unknown"}", so there is no artefact to fetch`,
    };
  }
  if (w.artifacts.length === 0) {
    return { fetch: false, reason: "the successful run uploaded no artefacts" };
  }
  const pick = chooseArtifact(w.edition, w.artifacts);
  if (!pick) return { fetch: false, reason: "no artefact matched this edition" };
  return { fetch: true, reason: pick.name };
}

/** A one-line status a shell can display without formatting anything. */
export function describeWatch(w: DispatchWatch): string {
  if (w.error) return `${w.workflow}: ${w.error}`;
  if (w.status === "queued") return `${w.workflow}: queued (${w.polls} polls)`;
  if (w.status === "in_progress") return `${w.workflow}: ${w.progress}% (${w.polls} polls)`;
  if (w.status === "completed") {
    if (w.conclusion !== "success") return `${w.workflow}: concluded ${w.conclusion}`;
    if (w.downloadedTo) return `${w.workflow}: saved to ${w.downloadedTo}`;
    if (w.artifacts.length) return `${w.workflow}: succeeded, ${w.artifacts.length} artefact(s) ready`;
    return `${w.workflow}: succeeded, nothing uploaded`;
  }
  return `${w.workflow}: unknown`;
}
