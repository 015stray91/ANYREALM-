/**
 * Container unpacking.
 *
 * Firmware arrives as `.img` or `.bin`, and inside that is almost always one of
 * three containers: gzip, xz, or lz4 (often lz4-legacy, which is what Android's
 * `lz4 -l` produces). The dissection cannot start until the container is off, so
 * this module handles that and nothing else.
 *
 * Order of attack is deliberate:
 *
 *   1. If the header magic says the compression, use the real decoder.
 *   2. If the magic is absent, try lz4 anyway. Android images are frequently
 *      lz4 frames with no magic because they were produced by a tool that
 *      stripped it, and a wrong guess fails cleanly at the first block.
 *   3. Only if both fail, fall back to the system binaries. They are the most
 *      capable and the least portable, so they are last.
 *
 * Every path returns the decompressed buffer plus what was detected, so the
 * caller can report the container rather than just silently unwrapping it.
 */

import zlib from "zlib";
import { execFileSync } from "child_process";
import { sniffCompression } from "./firmware-dissect";

export interface UnpackResult {
  buffer: Buffer;
  /** What the container turned out to be, for reporting. */
  container: "none" | "gzip" | "xz" | "lz4" | "lz4-legacy" | "unknown";
  /** How it was decoded, so a failure can say what was tried. */
  method: "in-process" | "system-binary" | "already-raw";
  originalSize: number;
  unpackedSize: number;
  notes: string[];
  /** True when the payload's own format is still readable after unwrapping. */
  looksLikeAndroidImage: boolean;
  /** Payload-level container, e.g. a boot.img inside a gzip'd .bin. */
  inner?: string;
}

/** Android's lz4 legacy frames begin with this magic. */
const LZ4_LEGACY_MAGIC = Buffer.from([0x02, 0x21, 0x4c, 0x18]);
/** Standard lz4 frame magic. */
const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);

function hasMagic(buf: Buffer, magic: Buffer): boolean {
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

function isAndroidMagic(buf: Buffer): boolean {
  return (
    buf.length >= 16 &&
    (buf.subarray(0, 8).toString("ascii") === "ANDROID!" ||
      buf.subarray(8, 16).toString("ascii").startsWith("ANDROID!"))
  );
}

/** A sparse image (Android's `system.img` format) starts with this. */
function isSparse(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0xed26ff3a;
}

function tryGzip(buf: Buffer): Buffer | null {
  try {
    return zlib.gunzipSync(buf);
  } catch {
    return null;
  }
}

/** lz4js decodes standard frames; it is pure JS so it works anywhere. */
function tryLz4Frame(buf: Buffer): Buffer | null {
  try {
    const lz4 = require("lz4js") as { decompress: (src: Uint8Array) => Uint8Array };
    const out = lz4.decompress(buf);
    return Buffer.from(out);
  } catch {
    return null;
  }
}

function trySystem(tool: "lz4" | "xz" | "gzip", buf: Buffer, args: string[] = []): Buffer | null {
  try {
    const out = execFileSync(tool, [...args, "-d", "-c"], {
      input: buf,
      maxBuffer: 1024 * 1024 * 1024,
      timeout: 120_000,
      // These decoders write to stderr whenever they reject a payload, which is
      // the normal case for the "try every decoder" fallback below. Silence it
      // rather than leak it into the server log on every uploaded image.
      stdio: ["pipe", "pipe", "ignore"],
    });
    return Buffer.from(out);
  } catch {
    return null;
  }
}

/**
 * Unpack one layer of container. Synchronous version; see unpackLayers for the
 * version that keeps going until the payload is a real image.
 */
export function unpackContainer(input: Buffer): UnpackResult {
  const notes: string[] = [];
  const originalSize = input.length;

  const finish = (
    buffer: Buffer,
    container: UnpackResult["container"],
    method: UnpackResult["method"],
  ): UnpackResult => {
    const looksLikeAndroidImage = isAndroidMagic(buffer);
    return {
      buffer,
      container,
      method,
      originalSize,
      unpackedSize: buffer.length,
      notes,
      looksLikeAndroidImage,
      inner: isSparse(buffer) ? "sparse" : looksLikeAndroidImage ? "android-boot" : undefined,
    };
  };

  // Already raw: an Android image, a sparse image, or a cpio archive.
  if (isAndroidMagic(input) || isSparse(input) || input.subarray(0, 6).toString("ascii") === "070701") {
    notes.push("payload is already uncompressed");
    return finish(input, "none", "already-raw");
  }

  const sniffed = sniffCompression(input);

  if (sniffed === "gzip" || hasMagic(input, Buffer.from([0x1f, 0x8b]))) {
    const gz = tryGzip(input);
    if (gz) return finish(gz, "gzip", "in-process");
    notes.push("gzip magic present but the stream did not decode");
  }

  if (sniffed === "xz" || hasMagic(input, Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) {
    const x = trySystem("xz", input);
    if (x) return finish(x, "xz", "system-binary");
    const x2 = trySystem("xz", input, ["--format=lzma"]);
    if (x2) return finish(x2, "xz", "system-binary");
    notes.push("xz magic present but the stream did not decode");
  }

  if (hasMagic(input, LZ4_FRAME_MAGIC)) {
    const l = tryLz4Frame(input);
    if (l) return finish(l, "lz4", "in-process");
    const l2 = trySystem("lz4", input);
    if (l2) return finish(l2, "lz4", "system-binary");
    notes.push("lz4 frame magic present but the stream did not decode");
  }

  if (hasMagic(input, LZ4_LEGACY_MAGIC)) {
    // Legacy frames are not decodable by lz4js; the system binary handles them.
    const l = trySystem("lz4", input);
    if (l) return finish(l, "lz4-legacy", "system-binary");
    notes.push("lz4 legacy magic present but the stream did not decode");
  }

  // No usable magic. Try each decoder anyway, because stripped-magic frames
  // are common in vendor firmware dumps.
  const lz4NoMagic = trySystem("lz4", input);
  if (lz4NoMagic) {
    notes.push("no container magic, but the lz4 decoder accepted it");
    return finish(lz4NoMagic, "lz4", "system-binary");
  }
  const xzNoMagic = trySystem("xz", input);
  if (xzNoMagic) {
    notes.push("no container magic, but the xz decoder accepted it");
    return finish(xzNoMagic, "xz", "system-binary");
  }

  notes.push(
    `unrecognised container (first bytes: ${input.subarray(0, 8).toString("hex")}). ` +
      "Not gzip, xz or lz4, and not already a boot/sparse/cpio image.",
  );
  return finish(input, "unknown", "already-raw");
}

/**
 * Unpack repeatedly until the payload stops shrinking. Some vendor dumps are
 * double-wrapped (a .bin holding a gzip'd boot.img, for example), and stopping
 * after one layer would report the inner container as the image.
 */
export function unpackLayers(input: Buffer, maxLayers = 4): UnpackResult & { layers: UnpackResult[] } {
  const layers: UnpackResult[] = [];
  let current = input;
  for (let i = 0; i < maxLayers; i++) {
    const r = unpackContainer(current);
    layers.push(r);
    if (r.looksLikeAndroidImage || isSparse(r.buffer) || r.container === "none" || r.container === "unknown") {
      return { ...r, layers };
    }
    // Guard against a loop, not against shrinkage: a highly compressed layer
    // can expand to something larger than the file it came from, which is
    // normal and must not stop the unwrapping.
    if (r.method === "already-raw") return { ...r, layers };
    current = r.buffer;
  }
  const last = layers[layers.length - 1];
  return { ...last, layers };
}
