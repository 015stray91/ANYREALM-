/**
 * Format registry: what a firmware payload can be, and which tool handles it.
 *
 * The builder used to know three containers (gzip, xz, lz4) and one boot header.
 * Real vendor dumps are messier than that: a factory package is often a tar or a
 * 7z holding tar.md5 files, which in turn hold sparse ext4 images, which hold a
 * cpio ramdisk. Each layer needs a different tool and each tool needs to exist
 * on the machine before the lab can promise anything.
 *
 * This module is the single list. The UI renders it, the dissect route consults
 * it, and the module/recovery labs use it to decide how to unpack their sources.
 * It is deliberately data, not code paths: adding a format means adding a row.
 */

import { execFile } from "child_process";
import fs from "fs";

export type FormatFamily = "archive" | "compressed" | "filesystem" | "android" | "kernel";

export interface FormatSpec {
  id: string;
  family: FormatFamily;
  /** Human name for the UI. */
  label: string;
  /** Extensions that normally identify it. */
  extensions: string[];
  /** First bytes, hex, with `?` wildcards. Empty when only the extension tells us. */
  magic: string[];
  /** Command that inspects without extracting. */
  inspect: string[] | null;
  /** Command that extracts into a directory. */
  unpack: string[] | null;
  /**
   * Command that recreates the format from a directory. Some formats have no
   * lossless repack (a boot image needs its header rewritten, not re-tarred), so
   * this is null and the reason is in `repackNote`.
   */
  repack: string[] | null;
  /** Tools that must exist for the row to be usable. */
  tools: string[];
  repackNote?: string;
  note?: string;
}

/**
 * `{in}`, `{out}` and `{dir}` are substituted by the caller. Keeping commands as
 * argv arrays rather than shell strings means a filename with a space or a quote
 * cannot turn into a second command.
 */
export const FORMATS: FormatSpec[] = [
  // ---- archives ------------------------------------------------------------
  {
    id: "zip",
    family: "archive",
    label: "ZIP",
    extensions: [".zip"],
    magic: ["504b0304", "504b0506"],
    inspect: ["unzip", "-l", "{in}"],
    unpack: ["unzip", "-o", "-q", "{in}", "-d", "{dir}"],
    repack: ["zip", "-r", "-q", "{out}", "."],
    tools: ["unzip", "zip"],
    note: "Factory packages (AP/PDA tars, OTA zips) are almost always this.",
  },
  {
    id: "tar",
    family: "archive",
    label: "tar",
    extensions: [".tar"],
    magic: ["7573746172"],
    inspect: ["tar", "-tf", "{in}"],
    unpack: ["tar", "-xf", "{in}", "-C", "{dir}"],
    repack: ["tar", "-cf", "{out}", "-C", "{dir}", "."],
    tools: ["tar"],
  },
  {
    id: "tar.gz",
    family: "archive",
    label: "tar.gz / .tgz",
    extensions: [".tar.gz", ".tgz"],
    magic: [],
    inspect: ["tar", "-tzf", "{in}"],
    unpack: ["tar", "-xzf", "{in}", "-C", "{dir}"],
    repack: ["tar", "-czf", "{out}", "-C", "{dir}", "."],
    tools: ["tar", "gzip"],
    note: "Vendor `*.tar.md5` packages are this, with a checksum line appended.",
  },
  {
    id: "tar.xz",
    family: "archive",
    label: "tar.xz / .txz",
    extensions: [".tar.xz", ".txz"],
    magic: ["fd377a585a00"],
    inspect: ["tar", "-tJf", "{in}"],
    unpack: ["tar", "-xJf", "{in}", "-C", "{dir}"],
    repack: ["tar", "-cJf", "{out}", "-C", "{dir}", "."],
    tools: ["tar", "xz"],
  },
  {
    id: "tar.bz2",
    family: "archive",
    label: "tar.bz2 / .tbz2",
    extensions: [".tar.bz2", ".tbz2"],
    magic: ["425a68"],
    inspect: ["tar", "-tjf", "{in}"],
    unpack: ["tar", "-xjf", "{in}", "-C", "{dir}"],
    repack: ["tar", "-cjf", "{out}", "-C", "{dir}", "."],
    tools: ["tar", "bzip2"],
  },
  {
    id: "tar.zst",
    family: "archive",
    label: "tar.zst",
    extensions: [".tar.zst", ".tzst"],
    magic: ["28b52ffd"],
    inspect: ["tar", "--zstd", "-tf", "{in}"],
    unpack: ["tar", "--zstd", "-xf", "{in}", "-C", "{dir}"],
    repack: ["tar", "--zstd", "-cf", "{out}", "-C", "{dir}", "."],
    tools: ["tar", "zstd"],
    note: "zstd is not installed in this image by default; the Arch/Ubuntu builder images have it.",
  },
  {
    id: "7z",
    family: "archive",
    label: "7-Zip",
    extensions: [".7z"],
    magic: ["377abcaf271c"],
    inspect: ["7z", "l", "{in}"],
    unpack: ["7z", "x", "-y", "-o{dir}", "{in}"],
    repack: ["7z", "a", "-y", "{out}", "."],
    tools: ["7z"],
    note: "Also the fallback for any archive the specific tools reject.",
  },
  {
    id: "rar",
    family: "archive",
    label: "RAR",
    extensions: [".rar"],
    magic: ["526172211a0700"],
    inspect: ["7z", "l", "{in}"],
    unpack: ["7z", "x", "-y", "-o{dir}", "{in}"],
    repack: null,
    tools: ["7z"],
    repackNote: "7-Zip can read RAR but cannot write it; repack as zip or 7z.",
  },

  // ---- single-stream compression ------------------------------------------
  {
    id: "gzip",
    family: "compressed",
    label: "gzip",
    extensions: [".gz"],
    magic: ["1f8b"],
    inspect: ["gzip", "-l", "{in}"],
    unpack: ["gzip", "-dc", "{in}"],
    repack: ["gzip", "-c"],
    tools: ["gzip"],
    repackNote: "Single stream: the tool writes to stdout; redirect to a file.",
  },
  {
    id: "xz",
    family: "compressed",
    label: "xz / lzma",
    extensions: [".xz", ".lzma"],
    magic: ["fd377a585a00"],
    inspect: ["xz", "-l", "{in}"],
    unpack: ["xz", "-dc", "{in}"],
    repack: ["xz", "-c"],
    tools: ["xz"],
    repackNote: "Single stream: writes to stdout.",
  },
  {
    id: "bzip2",
    family: "compressed",
    label: "bzip2",
    extensions: [".bz2"],
    magic: ["425a68"],
    inspect: null,
    unpack: ["bzip2", "-dc", "{in}"],
    repack: ["bzip2", "-c"],
    tools: ["bzip2"],
    note: "No listing command; it is one stream, so \"inspect\" only reports the size.",
    repackNote: "Single stream: writes to stdout.",
  },
  {
    id: "zstd",
    family: "compressed",
    label: "zstd",
    extensions: [".zst"],
    magic: ["28b52ffd"],
    inspect: ["zstd", "-l", "{in}"],
    unpack: ["zstd", "-dc", "{in}"],
    repack: ["zstd", "-c"],
    tools: ["zstd"],
    repackNote: "Single stream: writes to stdout.",
  },
  {
    id: "lz4",
    family: "compressed",
    label: "lz4 (frame + Android legacy)",
    extensions: [".lz4"],
    magic: ["04224d18", "02214c18"],
    inspect: ["lz4", "-l", "{in}"],
    unpack: ["lz4", "-dc", "{in}"],
    repack: ["lz4", "-l", "-c"],
    tools: ["lz4"],
    note: "Android ramdisks use the legacy frame (`lz4 -l`); the plain frame will not decode them.",
    repackNote: "Use `-l` for a legacy frame that Android's init can read.",
  },

  // ---- filesystems ---------------------------------------------------------
  {
    id: "ext4",
    family: "filesystem",
    label: "ext4",
    extensions: [".img", ".ext4"],
    magic: ["53ef"],
    inspect: ["debugfs", "-R", "stats", "{in}"],
    unpack: ["debugfs", "-R", "rdump / {dir}", "{in}"],
    repack: null,
    tools: ["debugfs"],
    repackNote: "Rebuild with mke2fs -d <dir>, not a repack; sizes and inode layout must be chosen.",
    note: "`debugfs rdump` reads the image as a file: no root, no loop device, cannot touch the host.",
  },
  {
    id: "erofs",
    family: "filesystem",
    label: "EROFS",
    extensions: [".img"],
    magic: ["e2e1f5e0"],
    inspect: ["dump.erofs", "-s", "{in}"],
    unpack: ["fsck.erofs", "--extract={dir}", "{in}"],
    repack: ["mkfs.erofs", "{out}", "{dir}"],
    tools: ["dump.erofs", "fsck.erofs", "mkfs.erofs"],
    note: "Android 13+ system/vendor images. Needs erofs-utils; absent from this image.",
  },
  {
    id: "squashfs",
    family: "filesystem",
    label: "SquashFS",
    extensions: [".sfs", ".squashfs"],
    magic: ["68737173", "73717368"],
    inspect: ["unsquashfs", "-l", "{in}"],
    unpack: ["unsquashfs", "-d", "{dir}", "{in}"],
    repack: ["mksquashfs", "{dir}", "{out}", "-comp", "xz", "-noappend"],
    tools: ["unsquashfs", "mksquashfs"],
  },

  // ---- Android payloads ----------------------------------------------------
  {
    id: "sparse",
    family: "android",
    label: "Android sparse image",
    extensions: [".img"],
    magic: ["3aff26ed"],
    inspect: null,
    unpack: ["simg2img", "{in}", "{out}"],
    repack: ["img2simg", "{in}", "{out}"],
    tools: ["simg2img", "img2simg"],
    note: "A container around ext4/erofs. Convert to raw first, then use the filesystem row.",
    repackNote: "img2simg is in android-sdk-libsparse-utils, not installed here.",
  },
  {
    id: "cpio",
    family: "android",
    label: "cpio ramdisk",
    extensions: [".cpio"],
    magic: ["303730373031", "303730373032"],
    inspect: ["cpio", "-itv"],
    unpack: ["cpio", "-idmu", "--no-absolute-filenames"],
    repack: ["cpio", "-o", "-H", "newc"],
    tools: ["cpio"],
    note: "Reads stdin, so the caller pipes the file in. Ramdisks are newc, not odc.",
    repackNote: "Writes to stdout; pipe to a file, then compress with the original container.",
  },
  {
    id: "payload.bin",
    family: "android",
    label: "OTA payload.bin",
    extensions: [".bin", ".zip"],
    magic: ["43524d41", "424e4348"],
    inspect: ["payload-dumper-go", "-l", "{in}"],
    unpack: ["payload-dumper-go", "-o", "{dir}", "{in}"],
    repack: null,
    tools: ["payload-dumper-go"],
    repackNote: "A/B OTA payloads are not repacked locally; the OTA tooling regenerates them.",
    note: "ChromeOS/Android update payload. Inside a factory zip, not standalone.",
  },
  {
    id: "boot",
    family: "android",
    label: "Android boot / init_boot / recovery",
    extensions: [".img"],
    magic: ["414e44524f494421"],
    inspect: ["file", "{in}"],
    unpack: ["unpackbootimg", "-i", "{in}", "-o", "{dir}"],
    repack: ["mkbootimg", "--config", "{dir}/bootimg.cfg", "-o", "{out}"],
    tools: ["unpackbootimg", "mkbootimg"],
    note: "The builder parses header v0-v4 itself, so this row is for the CLI path.",
  },
  {
    id: "vendor_boot",
    family: "android",
    label: "vendor_boot (v4 fragments)",
    extensions: [".img"],
    magic: ["414e44524f494421"],
    inspect: ["file", "{in}"],
    unpack: ["unpackbootimg", "-i", "{in}", "-o", "{dir}"],
    repack: ["mkbootimg", "--config", "{dir}/bootimg.cfg", "-o", "{out}"],
    tools: ["unpackbootimg", "mkbootimg"],
    note: "Two-stage ramdisk: fragments are named, and the second stage lives here, not in boot.img.",
  },

  // ---- kernel-side ---------------------------------------------------------
  {
    id: "bzImage",
    family: "kernel",
    label: "x86 bzImage",
    extensions: [".img", ""],
    magic: ["4d5a"],
    inspect: ["file", "{in}"],
    unpack: ["extract-vmlinux"],
    repack: null,
    tools: ["extract-vmlinux"],
    repackNote: "Build from source; there is no lossless repack of a compressed kernel.",
  },
  {
    id: "zImage",
    family: "kernel",
    label: "ARM zImage / Image.gz",
    extensions: [".img"],
    magic: [],
    inspect: ["file", "{in}"],
    unpack: ["file"],
    repack: null,
    tools: ["file"],
    repackNote: "Build from source.",
  },
];

export interface ToolStatus {
  tool: string;
  path: string | null;
  /** What breaks without it, stated in terms of the formats, not the tool. */
  blocks: string[];
}

/**
 * Which of the registry's tools exist here. Recomputed per call so installing a
 * package does not require a restart.
 */
export function probeTools(): ToolStatus[] {
  const need = new Map<string, string[]>();
  for (const f of FORMATS) {
    const all = [...f.tools];
    for (const t of all) {
      if (!need.has(t)) need.set(t, []);
      need.get(t)!.push(f.label);
    }
  }
  const out: ToolStatus[] = [];
  for (const [tool, blocks] of need) {
    const p = which(tool);
    out.push({ tool, path: p, blocks: p ? [] : blocks });
  }
  return out.sort((a, b) => Number(!!a.path) - Number(!!b.path) || a.tool.localeCompare(b.tool));
}

function which(tool: string): string | null {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const d of dirs) {
    const p = `${d}/${tool}`;
    try {
      const st = fs.statSync(p);
      if (st.isFile() && (st.mode & 0o111) !== 0) return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Fill `{in}`, `{out}`, `{dir}` placeholders. */
export function renderCommand(argv: string[], vars: { input?: string; output?: string; dir?: string }): string[] {
  return argv.map((a) =>
    a
      .replace(/\{in\}/g, vars.input ?? "{in}")
      .replace(/\{out\}/g, vars.output ?? "{out}")
      .replace(/\{dir\}/g, vars.dir ?? "{dir}"),
  );
}

/** Sniff by magic first, then by extension. Magic wins: a mislabelled .bin is common. */
export function identify(fileName: string, head: Buffer): FormatSpec | null {
  const hex = head.subarray(0, 16).toString("hex");
  const lower = fileName.toLowerCase();

  // Longest extension first so .tar.gz is not read as .gz.
  const byExt = [...FORMATS]
    .sort((a, b) => Math.max(...b.extensions.map((e) => e.length), 0) - Math.max(...a.extensions.map((e) => e.length), 0))
    .find((f) => f.extensions.some((e) => e && lower.endsWith(e)));

  const byMagic = FORMATS.find((f) => f.magic.some((m) => matchesHex(hex, m)));
  if (byMagic && byMagic.family !== "compressed") return byMagic;
  if (byMagic && byExt && byMagic.id === byExt.id) return byMagic;
  return byExt ?? byMagic ?? null;
}

function matchesHex(hex: string, pattern: string): boolean {
  if (hex.length < pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p === "?") continue;
    if (p !== hex[i]) return false;
  }
  return true;
}

export interface InspectResult {
  format: string;
  label: string;
  ok: boolean;
  output: string;
  /** Files found, when the inspector's output can be counted. */
  entries?: number;
  error?: string;
  command: string;
}

/** Run the format's inspect command and return its output verbatim. */
export function inspectFile(filePath: string, format: FormatSpec, timeoutMs = 120_000): Promise<InspectResult> {
  const argv = format.inspect ? renderCommand(format.inspect, { input: filePath }) : null;
  const command = argv ? argv.join(" ") : `(${format.label}: no listing command)`;
  if (!argv) {
    return Promise.resolve({ format: format.id, label: format.label, ok: true, output: "", command });
  }
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = `${stdout ?? ""}${stderr ?? ""}`.trim();
      resolve({
        format: format.id,
        label: format.label,
        ok: !err,
        output: text,
        entries: countEntries(text),
        error: err ? String((err as any).message ?? err) : undefined,
        command,
      });
    });
  });
}

function countEntries(text: string): number | undefined {
  if (!text) return undefined;
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.length;
}
