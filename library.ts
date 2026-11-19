/**
 * Local core library.
 *
 * The builder composes a build out of parts: a kernel tree, a rootfs, a firmware
 * dump, an upstream recovery source. Until now every part had to be re-typed as
 * a path in each panel, so the same tree was named five times and four of those
 * were stale.
 *
 * The library is a persisted index of directories the user has vouched for. Each
 * entry is scanned once (bounded, no recursion into .git objects), classified by
 * what it structurally contains rather than by its name, and then assigned to one
 * or more slots. Panels ask the library for "the kernel tree" instead of asking
 * the user again.
 *
 * Classification is structural on purpose. A directory called `kernel-zenith`
 * that has no `Makefile` with `VERSION =` is not a kernel tree, and saying so at
 * index time is much cheaper than discovering it during a build.
 */

import fs from "fs";
import path from "path";

export type SlotId =
  | "kernel-tree"
  | "rootfs"
  | "firmware"
  | "module-source"
  | "recovery-source"
  | "toolchain"
  | "patches"
  | "other";

export interface LibraryEntry {
  id: string;
  /** Absolute path as the user gave it. */
  path: string;
  /** Short label; defaults to the directory name. */
  label: string;
  /** Slots this directory has been assigned to. */
  slots: SlotId[];
  /** What it structurally looks like, with the evidence. */
  kind: string;
  evidence: string[];
  /** Bounded inventory. */
  stats: {
    files: number;
    bytes: number;
    truncated: boolean;
    scannedAt: string;
  };
  notes: string[];
  warnings: string[];
}

export interface LibraryFile {
  version: 1;
  entries: LibraryEntry[];
}

const SLOT_LABELS: Record<SlotId, string> = {
  "kernel-tree": "Kernel tree",
  rootfs: "Root filesystem",
  firmware: "Firmware dump",
  "module-source": "Module source",
  "recovery-source": "Recovery source",
  toolchain: "Toolchain",
  patches: "Patch set",
  other: "Other",
};

export function slotCatalog() {
  return (Object.keys(SLOT_LABELS) as SlotId[]).map((id) => ({
    id,
    label: SLOT_LABELS[id],
    hint: SLOT_HINTS[id],
  }));
}

const SLOT_HINTS: Record<SlotId, string> = {
  "kernel-tree": "A directory with a top-level Makefile whose VERSION = line names the kernel series.",
  rootfs: "An unpacked Linux user space: etc/ and usr/ or bin/ present, no top-level Makefile.",
  firmware: "A dump of partition images or firmware blobs: .img/.bin files, or a vendor firmware tree.",
  "module-source": "A directory with a Kbuild or Makefile using obj-m, or a .kpm plus its sources.",
  "recovery-source": "A recovery tree: device/<vendor>/<codename>/, or a gearlock/ directory.",
  toolchain: "A cross compiler: bin/ containing <triple>-gcc, and a sysroot.",
  patches: "A directory of .patch/.diff files, or a quilt series file.",
  other: "Anything else worth remembering the path of.",
};

const MAX_FILES = 20_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".gradle", "__pycache__", ".cache", "out", "dist"]);

/**
 * Walk a directory with a hard file cap. A 250 GB AOSP checkout must not turn
 * "index this folder" into a ten-minute hang, so the walk stops at MAX_FILES and
 * says it was truncated rather than pretending the count is exact.
 */
function walk(root: string, maxFiles = MAX_FILES): { files: number; bytes: number; truncated: boolean; tops: string[]; names: Set<string> } {
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const tops: string[] = [];
  const names = new Set<string>();
  const stack: string[] = [root];

  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (d.isDirectory()) tops.push(`${d.name}/`);
      else tops.push(d.name);
    }
  } catch {
    /* unreadable */
  }

  while (stack.length && !truncated) {
    const dir = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        files++;
        if (names.size < 5000) names.add(e.name);
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* raced */
        }
        if (files >= maxFiles) {
          truncated = true;
          break;
        }
      }
    }
  }
  return { files, bytes, truncated, tops, names };
}

function readHead(file: string, maxBytes = 8192): string {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return "";
  }
}

/** Structural classification. Returns kind plus the evidence that decided it. */
function classify(root: string, inv: { tops: string[]; names: Set<string>; files: number }): { kind: string; evidence: string[]; slots: SlotId[] } {
  const evidence: string[] = [];
  const slots: SlotId[] = [];
  const topSet = new Set(inv.tops.map((t) => t.replace(/\/$/, "")));

  // Kernel tree: top-level Makefile with VERSION = / PATCHLEVEL =
  if (topSet.has("Makefile")) {
    const head = readHead(path.join(root, "Makefile"), 4096);
    const v = /^VERSION\s*=\s*(\d+)/m.exec(head)?.[1];
    const p = /^PATCHLEVEL\s*=\s*(\d+)/m.exec(head)?.[1];
    if (v && p) {
      evidence.push(`Makefile: VERSION = ${v}, PATCHLEVEL = ${p}`);
      slots.push("kernel-tree");
      if (topSet.has("arch")) evidence.push("has arch/");
      if (topSet.has("drivers")) evidence.push("has drivers/");
      if (topSet.has("fs")) evidence.push("has fs/");
      return { kind: `linux source ${v}.${p}.x`, evidence, slots };
    }
  }

  // Recovery source
  if (topSet.has("device") || topSet.has("gearlock")) {
    if (topSet.has("device")) {
      evidence.push("has device/ (device tree layout)");
      const heads: string[] = [];
      try {
        for (const vendor of fs.readdirSync(path.join(root, "device"), { withFileTypes: true })) {
          if (!vendor.isDirectory()) continue;
          try {
            for (const codename of fs.readdirSync(path.join(root, "device", vendor.name), { withFileTypes: true })) {
              if (codename.isDirectory()) heads.push(`${vendor.name}/${codename.name}`);
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
      if (heads.length) evidence.push(`devices: ${heads.slice(0, 6).join(", ")}${heads.length > 6 ? ` (+${heads.length - 6})` : ""}`);
      // TWRP/OrangeFox trees have bootable/recovery or a build.sh
      if (topSet.has("bootable") || topSet.has("build.sh")) {
        evidence.push(topSet.has("build.sh") ? "has build.sh" : "has bootable/recovery");
        slots.push("recovery-source");
      }
    }
    if (topSet.has("gearlock")) {
      evidence.push("has gearlock/ (GearLock environment)");
      slots.push("recovery-source");
    }
    if (slots.length) return { kind: "recovery source tree", evidence, slots };
    evidence.push("has device/ but no build entry point found");
    return { kind: "android device tree", evidence, slots: ["other"] };
  }

  // Module source
  for (const f of ["Kbuild", "Makefile"]) {
    if (topSet.has(f)) {
      const head = readHead(path.join(root, f), 4096);
      if (/obj-m\s*[:+]?=/.test(head)) {
        evidence.push(`${f} contains obj-m`);
        slots.push("module-source");
        if (topSet.has("Kbuild")) evidence.push("has Kbuild");
        return { kind: "out-of-tree kernel module source", evidence, slots };
      }
    }
  }
  if ([...inv.names].some((n) => n.endsWith(".kpm"))) {
    evidence.push("contains a .kpm file");
    return { kind: "KPM module bundle", evidence, slots: ["module-source"] };
  }

  // Patch set
  const patches = [...inv.names].filter((n) => /\.(patch|diff)$/.test(n));
  if (patches.length > 0) {
    const series = topSet.has("series");
    evidence.push(`${patches.length} patch file(s)${series ? ", quilt series present" : ""}`);
    if (inv.files === patches.length || series) return { kind: "patch set", evidence, slots: ["patches"] };
  }

  // Toolchain
  const hasGcc = [...inv.names].some((n) => /-(gcc|clang|ld)$/.test(n));
  if (topSet.has("bin") && hasGcc) {
    evidence.push("has bin/ with a compiler");
    if (topSet.has("sysroot") || topSet.has("lib")) evidence.push("has sysroot/lib");
    return { kind: "cross toolchain", evidence, slots: ["toolchain"] };
  }

  // Rootfs
  if ((topSet.has("etc") && (topSet.has("usr") || topSet.has("bin") || topSet.has("sbin"))) || topSet.has("system")) {
    evidence.push(topSet.has("system") ? "has system/ (Android layout)" : "has etc/ + usr/ or bin/");
    if (topSet.has("usr")) evidence.push("has usr/");
    return { kind: "unpacked root filesystem", evidence, slots: ["rootfs"] };
  }

  // Firmware dump
  const imgs = [...inv.names].filter((n) => /\.(img|bin|mbn|elf|fw)$/i.test(n));
  if (imgs.length >= 2) {
    evidence.push(`${imgs.length} image/blob files at top level or near it`);
    return { kind: "firmware dump", evidence, slots: ["firmware"] };
  }

  evidence.push(
    inv.files === 0
      ? "empty or unreadable"
      : `no structural marker recognised among ${inv.tops.slice(0, 5).join(", ")}`,
  );
  return { kind: "unclassified", evidence, slots: ["other"] };
}

function libraryPath(workRoot: string) {
  return path.join(workRoot, "library.json");
}

export function readLibrary(workRoot: string): LibraryFile {
  const p = libraryPath(workRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed;
  } catch {
    /* fresh library */
  }
  return { version: 1, entries: [] };
}

export function writeLibrary(workRoot: string, lib: LibraryFile) {
  fs.mkdirSync(workRoot, { recursive: true });
  const tmp = libraryPath(workRoot) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 2));
  fs.renameSync(tmp, libraryPath(workRoot));
}

export function indexDirectory(dir: string, label?: string): LibraryEntry {
  const abs = path.resolve(dir);
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw new Error(`${abs} is not a directory`);

  const inv = walk(abs);
  const { kind, evidence, slots } = classify(abs, inv);

  const warnings: string[] = [];
  if (inv.truncated) warnings.push(`inventory stopped at ${MAX_FILES} files; counts are a floor, not a total`);
  if (slots.length === 1 && slots[0] === "other" && kind === "unclassified") {
    warnings.push("nothing structural identified it — it can still be assigned to a slot by hand");
  }
  const notes: string[] = [];
  const entryId = path.basename(abs).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dir";

  return {
    id: entryId,
    path: abs,
    label: label || path.basename(abs),
    slots,
    kind,
    evidence,
    stats: {
      files: inv.files,
      bytes: inv.bytes,
      truncated: inv.truncated,
      scannedAt: new Date().toISOString(),
    },
    notes,
    warnings,
  };
}

/** The best entry for a slot: most recently scanned among those assigned to it. */
export function resolveSlot(lib: LibraryFile, slot: SlotId): LibraryEntry | null {
  const candidates = lib.entries.filter((e) => e.slots.includes(slot));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => (a.stats.scannedAt < b.stats.scannedAt ? 1 : -1))[0];
}

/** Everything in the library, grouped by slot, for a panel that assigns paths. */
export function assignmentMatrix(lib: LibraryFile) {
  return slotCatalog().map((s) => ({
    ...s,
    entries: lib.entries
      .filter((e) => e.slots.includes(s.id as SlotId))
      .map((e) => ({ id: e.id, label: e.label, path: e.path, kind: e.kind })),
    resolved: resolveSlot(lib, s.id as SlotId)?.id ?? null,
  }));
}
