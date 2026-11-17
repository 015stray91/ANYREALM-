/**
 * Firmware extraction.
 *
 * Turns uploaded firmware into the trees a build actually needs, so a device
 * that is already in hand never costs 250 GB of AOSP download. The device's own
 * system/vendor/product images are the Android half; the kernel comes from the
 * vendor dump; only the Linux user space has to be fetched.
 *
 * Three payload shapes matter, and each needs a different tool:
 *
 *   ext4 (possibly inside a sparse wrapper)  -> debugfs rdump, no root needed
 *   cpio ramdisk (possibly gzipped/lz4'd)    -> cpio, after container-unpack
 *   a factory archive (.zip)                 -> unzip, then recurse
 *
 * `debugfs rdump` is the important choice. Mounting would need root and a loop
 * device; rdump reads an ext4 image as a file, which works in a container and
 * cannot damage the host. It does print chown warnings when run unprivileged,
 * which are expected and harmless -- the file contents are correct.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { unpackLayers } from "./container-unpack";

export interface ExtractResult {
  /** Which input this came from. */
  input: string;
  ok: boolean;
  /** "ext4" | "cpio" | "sparse" | "zip" | "boot" | "unknown" */
  payload: string;
  /** Directory the files landed in, if any. */
  outputDir?: string;
  files: number;
  bytes: number;
  durationMs: number;
  notes: string[];
  error?: string;
  /** Top-level directories found, so the caller can see it looks like a rootfs. */
  topLevel: string[];
}

function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 600_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

function countTree(dir: string): { files: number; bytes: number; topLevel: string[] } {
  let files = 0;
  let bytes = 0;
  const top = new Set<string>();
  const stack: Array<{ p: string; rel: string }> = [{ p: dir, rel: "" }];
  while (stack.length) {
    const { p, rel } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(p, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (!rel) top.add(e.name);
      try {
        const st = fs.lstatSync(abs);
        if (st.isDirectory()) stack.push({ p: abs, rel: childRel });
        else if (st.isFile()) {
          files++;
          bytes += st.size;
        }
      } catch {
        /* races with our own writes are expected */
      }
    }
  }
  return { files, bytes, topLevel: [...top].sort() };
}

/** Filesystem magic at offset 0x438 tells ext2/3/4 apart from anything else. */
function isExt4(buf: Buffer): boolean {
  if (buf.length < 0x43a) return false;
  return buf.readUInt16LE(0x438) === 0xef53;
}

function isSparse(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0xed26ff3a;
}

function isCpio(buf: Buffer): boolean {
  return buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "070701";
}

function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

/**
 * Extract one firmware image into a directory.
 *
 * `name` only affects diagnostics and the output subdirectory, so two images
 * called the same thing get separate trees rather than overwriting each other.
 */
export async function extractImage(
  input: Buffer,
  name: string,
  workRoot: string,
): Promise<ExtractResult> {
  const started = Date.now();
  const notes: string[] = [];
  const safeName = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  const outDir = path.join(workRoot, safeName.replace(/\.[^.]+$/, ""));
  const done = (payload: string, ok: boolean, extra: Partial<ExtractResult> = {}): ExtractResult => ({
    input: name,
    ok,
    payload,
    files: 0,
    bytes: 0,
    durationMs: Date.now() - started,
    notes,
    topLevel: [],
    ...extra,
  });

  // Unwrap first: an ext4 image inside a gzip'd .bin is common in vendor dumps.
  const unpacked = unpackLayers(input);
  // Report only the layers that actually unwrapped something. The terminal
  // layer is the payload itself, which is "unknown" by design and reads as an
  // error if it is included in the chain.
  const unwrapped = unpacked.layers.filter((l) => l.container !== "none" && l.container !== "unknown");
  if (unwrapped.length > 0) {
    notes.push(
      `unwrapped ${unwrapped.map((l) => l.container).join(" -> ")} ` +
        `(${input.length} -> ${unpacked.buffer.length} bytes)`,
    );
  }
  const payload = unpacked.buffer;

  fs.mkdirSync(workRoot, { recursive: true });

  // A factory archive: extract, then recurse over whatever is inside.
  if (isZip(payload) || isZip(input)) {
    const zipPath = path.join(workRoot, `${safeName}.zip`);
    fs.writeFileSync(zipPath, input);
    fs.mkdirSync(outDir, { recursive: true });
    const r = await run("unzip", ["-o", "-q", zipPath, "-d", outDir], { timeoutMs: 900_000 });
    if (r.code !== 0) {
      notes.push(...r.stderr.trim().split("\n").slice(-3));
      return done("zip", false, { error: "unzip failed", outputDir: outDir });
    }
    const counted = countTree(outDir);
    notes.push("factory archive extracted; recurse into its images for the filesystem trees");
    return done("zip", true, { outputDir: outDir, ...counted });
  }

  // ext4, possibly still sparse-wrapped.
  let ext4Buf = payload;
  let sparseNote = "";
  if (isSparse(payload)) {
    const sparsePath = path.join(workRoot, `${safeName}.sparse`);
    const rawPath = path.join(workRoot, `${safeName}.raw`);
    fs.writeFileSync(sparsePath, payload);
    const r = await run("simg2img", [sparsePath, rawPath]);
    if (r.code !== 0) {
      notes.push(...r.stderr.trim().split("\n").slice(-3));
      return done("sparse", false, { error: "simg2img failed" });
    }
    ext4Buf = fs.readFileSync(rawPath);
    sparseNote = `sparse image unsparsed (${fs.statSync(sparsePath).size} -> ${fs.statSync(rawPath).size} bytes)`;
    notes.push(sparseNote);
    fs.unlinkSync(sparsePath);
  }

  if (isExt4(ext4Buf)) {
    const imgPath = path.join(workRoot, `${safeName}.ext4`);
    if (ext4Buf !== payload || isSparse(payload)) fs.writeFileSync(imgPath, ext4Buf);
    else fs.writeFileSync(imgPath, ext4Buf);
    fs.mkdirSync(outDir, { recursive: true });

    // rdump walks the image and writes real files. It needs no root and no loop
    // device; it does warn about chown when unprivileged, which is expected.
    const r = await run("debugfs", ["-R", `rdump / ${outDir}`, imgPath], { timeoutMs: 900_000 });
    const chownWarnings = (r.stderr.match(/Operation not permitted while changing ownership/g) ?? []).length;
    if (chownWarnings > 0) {
      notes.push(`${chownWarnings} ownership warning(s) from unprivileged rdump -- contents are unaffected`);
    }
    const counted = countTree(outDir);
    if (counted.files === 0) {
      notes.push(...r.stderr.trim().split("\n").slice(-3));
      return done(isSparse(payload) ? "sparse" : "ext4", false, {
        error: "ext4 image contained no files (corrupt, or not actually ext4)",
        outputDir: outDir,
      });
    }
    return done(isSparse(payload) ? "sparse" : "ext4", true, { outputDir: outDir, ...counted });
  }

  // A ramdisk: cpio, after whatever container it was in is already off.
  if (isCpio(payload)) {
    fs.mkdirSync(outDir, { recursive: true });
    const cpioPath = path.join(workRoot, `${safeName}.cpio`);
    fs.writeFileSync(cpioPath, payload);
    const r = await run("sh", ["-c", `cd ${JSON.stringify(outDir)} && cpio -idmu --no-absolute-filenames < ${JSON.stringify(cpioPath)}`]);
    if (r.code !== 0) {
      notes.push(...r.stderr.trim().split("\n").slice(-3));
      return done("cpio", false, { error: "cpio extraction failed", outputDir: outDir });
    }
    const counted = countTree(outDir);
    return done("cpio", true, { outputDir: outDir, ...counted });
  }

  // A boot image: hand it to the dissector, which reports rather than extracts.
  if (unpacked.looksLikeAndroidImage) {
    notes.push("this is a boot image; use the dissector to read its layout, not this extractor");
    return done("boot", false, { error: "boot images are dissected, not extracted" });
  }

  notes.push(
    `not ext4, cpio, sparse or zip (first bytes: ${payload.subarray(0, 8).toString("hex")}). ` +
      "If this is an erofs or f2fs filesystem, extraction needs a different tool.",
  );
  return done("unknown", false, { error: "unrecognised filesystem format" });
}
