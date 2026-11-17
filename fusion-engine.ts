/**
 * AnyRealm fusion engine.
 *
 * The whole point of AnyRealm is one userspace: several root file systems
 * merged into a single tree that boots on one kernel, with no chroot, proot or
 * container at run time. This module does that merge for real. It is the same
 * model as Bedrock Linux's strata, but flattened at build time instead of
 * resolved at run time.
 *
 * Rules, per top-level directory of each source:
 *
 *   fuse     - merge into the shared tree. First source wins on collision, the
 *              losing copy is kept and recorded, never silently dropped.
 *   isolate  - keep the whole directory under /<isolate-root>/<source>/<dir>,
 *              so a second libc or a second init system can coexist.
 *   exclude  - drop it from the merged tree entirely.
 *   stub     - create an empty directory if nothing else provides it.
 *
 * Two invariants from the project notes are enforced here, not left to the
 * caller:
 *
 *   1. Android's libc is never overwritten. If a second source carries
 *      lib/libc.so or lib64/libc.so and Android already provided it, the
 *      second copy is diverted to the keep area and reported as a collision.
 *   2. Nothing is deleted. Every displaced file is written under
 *      <output>/.anyrealm/keep/<source>/<original path> so the merge is
 *      reversible and auditable.
 */

import fs from "fs";
import path from "path";

export type Rule = "fuse" | "isolate" | "exclude" | "stub";

export interface SourceSpec {
  /** Short label used in paths and the report, e.g. "android", "kali". */
  name: string;
  /** Absolute path to an already-extracted root file system. */
  path: string;
  /** Highest priority wins collisions. Defaults to array order. */
  priority?: number;
}

export interface DirRule {
  /** Top-level directory name, e.g. "system", "usr", "etc". */
  name: string;
  rule: Rule;
  /** For rule "isolate": where to mount it in the merged tree. */
  isolateAs?: string;
  /** Only apply this rule for these sources; omit means all of them. */
  sources?: string[];
}

export interface Collision {
  relPath: string;
  winner: string;
  loser: string;
  /** True when this was a protected runtime library that must not be replaced. */
  protected: boolean;
  divertedTo: string;
}

export interface FusionReport {
  ok: boolean;
  output: string;
  sources: Array<{ name: string; path: string; priority: number; files: number }>;
  rules: DirRule[];
  collisions: Collision[];
  isolated: Array<{ source: string; dir: string; at: string }>;
  excluded: Array<{ source: string; dir: string }>;
  stubs: string[];
  stats: { filesWritten: number; bytesWritten: number; directories: number };
  warnings: string[];
  durationMs: number;
}

/** Runtime libraries that must never be taken from a later source. */
const PROTECTED = new Set([
  "lib/libc.so",
  "lib64/libc.so",
  "lib/libc.so.6",
  "lib64/libc.so.6",
  "lib/ld-linux-x86-64.so.2",
  "lib64/ld-linux-x86-64.so.2",
  "lib/ld-linux-aarch64.so.1",
  "lib/ld-musl-x86_64.so.1",
  "lib/ld-musl-aarch64.so.1",
  "system/lib64/libc.so",
  "system/lib/libc.so",
  "system/bin/linker64",
  "system/bin/linker",
]);

function isProtectedPath(rel: string): boolean {
  return PROTECTED.has(rel.replace(/^\.\//, ""));
}

function safeJoin(root: string, rel: string): string {
  const joined = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (joined !== rootResolved && !joined.startsWith(rootResolved + path.sep)) {
    throw new Error(`path escapes output root: ${rel}`);
  }
  return joined;
}

/** Walk a tree without following symlinks, so a source cannot drag in /proc. */
function walk(
  dir: string,
  base = "",
  out: Array<{ rel: string; abs: string; isDir: boolean; isLink: boolean }> = [],
  depth = 0,
): Array<{ rel: string; abs: string; isDir: boolean; isLink: boolean }> {
  if (depth > 64) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    let isLink = e.isSymbolicLink();
    if (!isLink) {
      // Dirent.isSymbolicLink can miss on some bind mounts; double-check.
      try {
        isLink = fs.lstatSync(abs).isSymbolicLink();
      } catch {
        continue;
      }
    }
    if (isLink) {
      out.push({ rel, abs, isDir: false, isLink: true });
      continue;
    }
    if (e.isDirectory()) {
      out.push({ rel, abs, isDir: true, isLink: false });
      walk(abs, rel, out, depth + 1);
    } else if (e.isFile()) {
      out.push({ rel, abs, isDir: false, isLink: false });
    }
  }
  return out;
}

function countFiles(root: string): number {
  try {
    return walk(root).filter((e) => !e.isDir).length;
  } catch {
    return 0;
  }
}

/**
 * Merge sources into a single tree.
 *
 * The output directory is wiped first: a merge that inherits yesterday's files
 * is not reproducible, and a stale file is exactly how a second libc sneaks
 * back into a "clean" image.
 */
export function fuseRootfs(opts: {
  sources: SourceSpec[];
  rules: DirRule[];
  output: string;
  isolateRoot?: string;
  dryRun?: boolean;
}): FusionReport {
  const started = Date.now();
  const output = path.resolve(opts.output);
  const isolateRoot = (opts.isolateRoot ?? "anyrealm-strata").replace(/^\/+|\/+$/g, "");
  const warnings: string[] = [];

  const sources = opts.sources.map((s, i) => ({
    ...s,
    priority: s.priority ?? i,
    path: path.resolve(s.path),
  }));

  // Highest priority first; ties keep declaration order.
  const ordered = [...sources].sort((a, b) => b.priority - a.priority);

  for (const s of ordered) {
    if (!fs.existsSync(s.path)) {
      throw new Error(`source root does not exist: ${s.name} -> ${s.path}`);
    }
    if (!fs.statSync(s.path).isDirectory()) {
      throw new Error(`source root is not a directory: ${s.name} -> ${s.path}`);
    }
  }

  const ruleFor = (dir: string, source: string): Rule => {
    const matches = opts.rules.filter(
      (r) => r.name === dir && (!r.sources || r.sources.includes(source)),
    );
    if (!matches.length) return "fuse";
    // The most specific matching rule wins (one with an explicit source list).
    const specific = matches.find((r) => r.sources && r.sources.includes(source));
    return (specific ?? matches[0]).rule;
  };
  const isolatePathFor = (dir: string, source: string): string => {
    const m = opts.rules.find(
      (r) => r.name === dir && r.rule === "isolate" && (!r.sources || r.sources.includes(source)),
    );
    return m?.isolateAs ?? `${isolateRoot}/${source}/${dir}`;
  };

  const collisions: Collision[] = [];
  const isolated: FusionReport["isolated"] = [];
  const excluded: FusionReport["excluded"] = [];
  const stubs: string[] = [];
  const claimed = new Map<string, string>(); // rel path -> source that owns it
  let filesWritten = 0;
  let bytesWritten = 0;
  let directories = 0;

  if (!opts.dryRun) {
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
  }

  const ensureDir = (rel: string) => {
    if (opts.dryRun) return;
    const abs = safeJoin(output, rel);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      directories++;
    }
  };

  for (const src of ordered) {
    const entries = walk(src.path);
    const topDirs = new Set<string>();
    for (const e of entries) {
      const top = e.rel.split("/")[0];
      if (top) topDirs.add(top);
    }

    for (const top of topDirs) {
      const rule = ruleFor(top, src.name);
      if (rule === "exclude") {
        excluded.push({ source: src.name, dir: top });
        continue;
      }
      if (rule === "stub") {
        if (!claimed.has(top)) {
          ensureDir(top);
          claimed.set(top, src.name);
          stubs.push(top);
        }
        continue;
      }
      if (rule === "isolate") {
        const at = isolatePathFor(top, src.name);
        isolated.push({ source: src.name, dir: top, at });
        for (const e of entries) {
          if (!e.rel.startsWith(top + "/") && e.rel !== top) continue;
          const target = path.posix.join(at, e.rel.slice(top.length).replace(/^\//, ""));
          if (e.isDir) {
            ensureDir(target);
          } else if (e.isLink) {
            if (opts.dryRun) continue;
            ensureDir(path.posix.dirname(target));
            const link = fs.readlinkSync(e.abs);
            const abs = safeJoin(output, target);
            fs.rmSync(abs, { force: true });
            fs.symlinkSync(link, abs);
            filesWritten++;
          } else {
            if (opts.dryRun) { filesWritten++; continue; }
            ensureDir(path.posix.dirname(target));
            const abs = safeJoin(output, target);
            fs.copyFileSync(e.abs, abs);
            try { fs.chmodSync(abs, fs.statSync(e.abs).mode); } catch { /* mode is advisory */ }
            filesWritten++;
            bytesWritten += fs.statSync(e.abs).size;
          }
        }
        continue;
      }

      // rule === "fuse"
      for (const e of entries) {
        // Only this top-level directory. Without this guard every directory
        // boundary reprocesses the whole source tree, which silently defeats
        // isolation by re-placing the isolated files at the root.
        if (e.rel !== top && !e.rel.startsWith(top + "/")) continue;
        if (e.isDir) {
          if (!claimed.has(e.rel)) {
            ensureDir(e.rel);
            claimed.set(e.rel, src.name);
          }
          continue;
        }

        const existing = claimed.get(e.rel);
        if (existing) {
          const prot = isProtectedPath(e.rel);
          const divertedTo = path.posix.join(
            ".anyrealm/keep", src.name, e.rel,
          );
          collisions.push({
            relPath: e.rel,
            winner: existing,
            loser: src.name,
            protected: prot,
            divertedTo,
          });
          if (prot) {
            warnings.push(
              `protected runtime ${e.rel} from ${src.name} was NOT installed; ` +
              `${existing} keeps it (copy kept at ${divertedTo})`,
            );
          }
          if (!opts.dryRun) {
            ensureDir(path.posix.dirname(divertedTo));
            const abs = safeJoin(output, divertedTo);
            if (e.isLink) {
              fs.rmSync(abs, { force: true });
              fs.symlinkSync(fs.readlinkSync(e.abs), abs);
            } else {
              fs.copyFileSync(e.abs, abs);
            }
            bytesWritten += e.isLink ? 0 : fs.statSync(e.abs).size;
          }
          continue;
        }

        // First provider wins.
        claimed.set(e.rel, src.name);
        if (opts.dryRun) { filesWritten++; continue; }
        ensureDir(path.posix.dirname(e.rel));
        const abs = safeJoin(output, e.rel);
        if (e.isLink) {
          fs.rmSync(abs, { force: true });
          fs.symlinkSync(fs.readlinkSync(e.abs), abs);
        } else {
          fs.copyFileSync(e.abs, abs);
          try { fs.chmodSync(abs, fs.statSync(e.abs).mode); } catch { /* mode is advisory */ }
          bytesWritten += fs.statSync(e.abs).size;
        }
        filesWritten++;
      }
    }
  }

  // Every declared stub that nothing provided still gets an empty directory.
  for (const r of opts.rules.filter((x) => x.rule === "stub")) {
    if (!claimed.has(r.name)) {
      ensureDir(r.name);
      claimed.set(r.name, "stub");
      stubs.push(r.name);
    }
  }

  const report: FusionReport = {
    ok: true,
    output,
    sources: sources.map((s) => ({
      name: s.name,
      path: s.path,
      priority: s.priority,
      files: countFiles(s.path),
    })),
    rules: opts.rules,
    collisions,
    isolated,
    excluded,
    stubs: Array.from(new Set(stubs)),
    stats: { filesWritten, bytesWritten, directories },
    warnings,
    durationMs: Date.now() - started,
  };

  if (!opts.dryRun) {
    const meta = path.join(output, ".anyrealm");
    fs.mkdirSync(meta, { recursive: true });
    fs.writeFileSync(path.join(meta, "manifest.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(meta, "fuse-report.md"), renderReport(report));
  }

  return report;
}

/** Plain-text report, written next to the merged tree and shown in the UI. */
export function renderReport(r: FusionReport): string {
  const lines: string[] = [];
  lines.push("# AnyRealm fusion report", "");
  lines.push(`output: \`${r.output}\``);
  lines.push(`duration: ${r.durationMs} ms`);
  lines.push(`files written: ${r.stats.filesWritten}`);
  lines.push(`bytes written: ${r.stats.bytesWritten}`);
  lines.push(`directories created: ${r.stats.directories}`, "");
  lines.push("## Sources (highest priority first)", "");
  for (const s of r.sources) lines.push(`- **${s.name}** \`${s.path}\` — ${s.files} files, priority ${s.priority}`);
  lines.push("", "## Isolated", "");
  if (!r.isolated.length) lines.push("- none");
  for (const i of r.isolated) lines.push(`- ${i.source}/${i.dir} → /${i.at}`);
  lines.push("", "## Excluded", "");
  if (!r.excluded.length) lines.push("- none");
  for (const e of r.excluded) lines.push(`- ${e.source}/${e.dir}`);
  lines.push("", "## Stubs", "");
  if (!r.stubs.length) lines.push("- none");
  for (const s of r.stubs) lines.push(`- /${s}`);
  lines.push("", `## Collisions (${r.collisions.length})`, "");
  if (!r.collisions.length) lines.push("- none");
  for (const c of r.collisions) {
    lines.push(
      `- \`${c.relPath}\` — ${c.winner} wins over ${c.loser}` +
      (c.protected ? " **(protected runtime, not replaced)**" : "") +
      `; loser kept at \`${c.divertedTo}\``,
    );
  }
  if (r.warnings.length) {
    lines.push("", "## Warnings", "");
    for (const w of r.warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Parse a "name=path" list, for the CLI and the API. */
export function parseSources(spec: string[]): SourceSpec[] {
  return spec.map((s, i) => {
    const eq = s.indexOf("=");
    if (eq < 0) throw new Error(`source must be name=path, got "${s}"`);
    return { name: s.slice(0, eq), path: s.slice(eq + 1), priority: spec.length - i };
  });
}

/** Which merge tools this machine actually has. The UI shows this so a panel
 *  never claims a capability the host cannot deliver. */
export function probeCapabilities(): Record<string, boolean> {
  const { execFileSync } = require("child_process") as typeof import("child_process");
  const has = (bin: string) => {
    try {
      execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  return {
    rsync: has("rsync"),
    mksquashfs: has("mksquashfs"),
    unsquashfs: has("unsquashfs"),
    xorriso: has("xorriso"),
    mkfs_erofs: has("mkfs.erofs"),
    lpmake: has("lpmake"),
    simg2img: has("simg2img"),
    debugfs: has("debugfs"),
    dtc: has("dtc"),
    debootstrap: has("debootstrap"),
  };
}
