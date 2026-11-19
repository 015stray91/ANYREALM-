/**
 * Patch and diff generation for module work.
 *
 * Three artifacts, three purposes, and they are not interchangeable:
 *
 *   .diff      `diff -u` between two trees or two files. Read by humans and by
 *              `git apply`. No mailbox header, so it applies with `patch -p1`.
 *   .patch     A git-style patch with `diff --git`, `index`, and `--- a/ +++ b/`
 *              paths. This is what `git am` consumes, and what a KPM's
 *              build recipe expects when it patches kernel sources.
 *   context    The chunk header lines. A patch that applies at the wrong offset
 *              is the common failure, so the builder reports the hunk offsets
 *              rather than just "applied".
 *
 * A KPM that patches the kernel needs the second form: the KernelPatch build
 * step applies its patch set to a kernel tree with `patch -p1` semantics against
 * paths rooted at the tree, and a bare `diff -u` of two files loses that rooting.
 *
 * Nothing here shells out blindly. `git diff --no-index` gives git-style output
 * without needing a repository, which is exactly the case for two extracted
 * kernel trees.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";

function run(cmd: string, args: string[], timeoutMs = 120_000) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; code: number }>((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 128 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? ((err as any).code ?? 1) : 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
      });
    });
  });
}

export interface PatchRequest {
  /** Directory or file that the patch should be relative to. */
  original: string;
  /** Modified counterpart. Same shape as `original`. */
  modified: string;
  /** "diff" for a plain unified diff, "patch" for a git-style patch. */
  style: "diff" | "patch";
  /** How many context lines. 3 is the default everything expects. */
  contextLines?: number;
  /** Prefix to strip when applying; recorded, not applied. */
  stripLevel?: number;
}

export interface PatchResult {
  ok: boolean;
  style: string;
  /** The patch text. */
  patch: string;
  bytes: number;
  files: number;
  additions: number;
  deletions: number;
  /** Hunk headers, so offset drift is visible before it is a build failure. */
  hunks: Array<{ file: string; header: string }>;
  /** Lines that will fail to apply as-is. */
  warnings: string[];
  error?: string;
}

/** Count `+`/`-` lines outside headers, and collect hunk headers. */
function analyse(patch: string) {
  let additions = 0;
  let deletions = 0;
  let files = 0;
  const hunks: Array<{ file: string; header: string }> = [];
  let current = "";

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ") || (line.startsWith("--- ") && !line.startsWith("--- /dev/null"))) {
      if (line.startsWith("diff --git ")) {
        files++;
        const m = / b\/(.+)$/.exec(line);
        current = m ? m[1] : line.replace("diff --git ", "");
      }
    }
    if (line.startsWith("@@")) {
      hunks.push({ file: current, header: line });
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { files, additions, deletions, hunks };
}

export async function buildPatch(req: PatchRequest): Promise<PatchResult> {
  const ctx = typeof req.contextLines === "number" ? Math.max(0, Math.min(20, req.contextLines)) : 3;
  const a = path.resolve(req.original);
  const b = path.resolve(req.modified);

  for (const p of [a, b]) {
    if (!fs.existsSync(p)) {
      return empty(`path does not exist: ${p}`, req.style);
    }
  }

  // --no-index works on two plain paths, so a repository is not required. The
  // exit code is 1 when there are differences, which is the normal case, so the
  // success test is "produced output", not "exited 0".
  const args =
    req.style === "patch"
      ? ["diff", "--no-index", "--no-color", `--unified=${ctx}`, "--src-prefix=a/", "--dst-prefix=b/", a, b]
      : ["diff", "--no-index", "--no-color", `--unified=${ctx}`, a, b];

  const r = await run("git", args, 180_000);

  if (!r.stdout.trim()) {
    if (r.ok) return empty(null, req.style, "the two trees are identical");
    return empty(r.stderr.trim() || "git diff produced no output", req.style);
  }

  let patch = r.stdout;

  // Rewrite absolute paths into rooted ones. A patch that names
  // /mnt/build/comb/drivers/foo.c only applies on the machine that made it, which
  // is the single most common reason a KPM patch fails on CI.
  patch = patch.replace(new RegExp(escapeRe(a), "g"), "a");
  patch = patch.replace(new RegExp(escapeRe(b), "g"), "b");

  if (req.style === "diff") {
    // Plain unified diff: drop the git preamble so `patch -p1` reads it without
    // complaining about index lines.
    patch = patch
      .split("\n")
      .filter((l) => !l.startsWith("diff --git ") && !l.startsWith("index ") && !l.startsWith("new file mode") && !l.startsWith("deleted file mode"))
      .join("\n");
  }

  const stats = analyse(patch);
  const warnings: string[] = [];

  for (const h of stats.hunks) {
    // A hunk header of the form `@@ -1,5 +1,7 @@` is fine; the interesting
    // failure is a zero-length original, which means a new file.
    if (h.header.includes("@@ -0,0")) continue;
  }
  if (stats.hunks.length === 0) warnings.push("no hunks: the diff is header-only");

  const strip = req.stripLevel ?? 1;
  if (req.style === "patch" && strip !== 1) {
    warnings.push(`git-style patches assume -p1; you asked for -p${strip}`);
  }

  return {
    ok: true,
    style: req.style,
    patch,
    bytes: Buffer.byteLength(patch),
    files: stats.files,
    additions: stats.additions,
    deletions: stats.deletions,
    hunks: stats.hunks,
    warnings,
  };
}

function empty(error: string | null, style: string, note?: string): PatchResult {
  return {
    ok: false,
    style,
    patch: "",
    bytes: 0,
    files: 0,
    additions: 0,
    deletions: 0,
    hunks: [],
    warnings: note ? [note] : [],
    error: error ?? undefined,
  };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The module-recipe shape a KPM build expects: a patch directory with a
 * `series` file, applied in order with `patch -p1`. Returning this as files
 * rather than prose means it can be dropped straight into a module repo.
 */
export function kpmRecipe(opts: { moduleName: string; kernelVersion: string; patchNames: string[] }) {
  const mod = opts.moduleName.replace(/[^A-Za-z0-9_-]/g, "_") || "anyrealm_kpm";
  const series = opts.patchNames.join("\n") + "\n";

  return [
    {
      path: "series",
      contents: `# Applied in this order with patch -p1 against the kernel tree.\n# Order matters: later patches assume earlier ones applied.\n${series}`,
    },
    {
      path: "Kbuild",
      contents: `# KernelPatch module build.\n# A .kpm is built against a full kernel tree and loaded by kpatch,\n# not by insmod.\n\nobj-m += ${mod}.o\n${mod}-y := main.o\n\nccflags-y += -I$(src)/include\n`,
    },
    {
      path: "main.c",
      contents: `// ${mod} — KernelPatch module skeleton.
//
// A KPM is loaded at runtime by kpatch on arm64. It is not an ELF module
// bound to a kernel ABI, so the checks that matter are: does the kernel
// version match the range this module declares, and do the hook target
// symbols exist in that kernel.
#include <linux/module.h>
#include <linux/kernel.h>

static int __init ${mod}_init(void)
{
\tpr_info("${mod}: init on kernel ${opts.kernelVersion}\\n");
\treturn 0;
}

static void __exit ${mod}_exit(void)
{
\tpr_info("${mod}: exit\\n");
}

module_init(${mod}_init);
module_exit(${mod}_exit);
MODULE_LICENSE("GPL");
`,
    },
    {
      path: "build.sh",
      contents: `#!/bin/sh
# Build ${mod} against a kernel tree, then report what the result binds to.
set -eu
KERNEL_TREE="\${1:?usage: build.sh /path/to/kernel/tree}"
make -C "$KERNEL_TREE" M="$(pwd)" modules
modinfo "${mod}.ko" | grep -E 'vermagic|license' || true
`,
    },
    {
      path: "README.md",
      contents: `# ${mod}

Target kernel: \`${opts.kernelVersion}\`

Build:

\`\`\`sh
./build.sh /path/to/kernel/tree
\`\`\`

The patch series in \`series\` is applied in order, with \`patch -p1\`, before the
module is built. A patch that applies at an unexpected offset is a warning sign
even when it succeeds: it means the kernel source has drifted from what the patch
was written against.
`,
    },
  ];
}
