/**
 * Boot image dissection.
 *
 * Reads Android boot and vendor_boot headers directly, in TypeScript, with no
 * external tools. These images are little-endian packed structs, so parsing
 * them is arithmetic, not magic -- which matters because `unpack_bootimg` and
 * `avbtool` are not installed everywhere and a firmware uploader that asks the
 * user to install them has failed at its one job.
 *
 * Header layouts come from AOSP system/tools/mkbootimg:
 *   boot v0-v2  page size in the header, kernel then ramdisk, each page-aligned
 *   boot v3     (Android 11+, the GKI "boot" partition) fixed 1580-byte header
 *   boot v4     (Android 13+) adds a signature and a vendor ramdisk table
 *   vendor_boot v3 (Android 11+) / v4 (Android 12+, multiple fragments)
 *
 * The point of parsing rather than shelling out: the result also tells the
 * builder what kind of device this is. A v4 vendor_boot with two ramdisk
 * fragments means a two-stage ramdisk, which means the second stage is *not* in
 * boot.img -- exactly the layout the genevn target uses.
 */

export type BootKind = "boot" | "vendor_boot" | "init_boot" | "unknown";

export interface RamdiskFragment {
  name: string;
  offset: number;
  size: number;
  /** "none" | "gzip" | "lz4" | "lzma" | "xz" | "unknown" */
  compression: string;
}

export interface BootImageInfo {
  kind: BootKind;
  headerVersion: number;
  headerSize: number;
  pageSize: number;
  kernel: { offset: number; size: number; compression: string };
  ramdisk: { offset: number; size: number; compression: string };
  second?: { offset: number; size: number; compression: string };
  osVersion?: { major: number; minor: number; patch: number; year: number; month: number };
  cmdline?: string;
  productName?: string;
  boardName?: string;
  /** boot v4 / vendor_boot: the named ramdisk fragments present. */
  fragments: RamdiskFragment[];
  /** True when a second-stage ramdisk exists outside boot.img. */
  twoStageRamdisk: boolean;
  warnings: string[];
  /** Everything the builder needs to choose a kernel and ROM. */
  deviceHints: DeviceHints;
}

export interface DeviceHints {
  arch?: "arm64" | "arm" | "x86_64" | "x86";
  pageSize?: number;
  /** Kernel version string, if the image embeds one (boot v3+ do not always). */
  kernelVersion?: string;
  hasVendorBoot?: boolean;
  hasInitBoot?: boolean;
  gkiGeneration?: "gki-1.0" | "gki-2.0" | "pre-gki" | "unknown";
  socHint?: string;
  /** Human-readable summary, shown before anything is built. */
  summary: string[];
}

const LZ4_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const XZ_MAGIC = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
const LZMA_MAGIC = Buffer.from([0x5d, 0x00, 0x00]);

/** Sniff compression from the first bytes. */
export function sniffCompression(buf: Buffer): string {
  if (buf.length < 6) return "unknown";
  if (buf.subarray(0, 4).equals(LZ4_MAGIC)) return "lz4";
  if (buf.subarray(0, 2).equals(GZIP_MAGIC)) return "gzip";
  if (buf.subarray(0, 6).equals(XZ_MAGIC)) return "xz";
  if (buf.subarray(0, 3).equals(LZMA_MAGIC)) return "lzma";
  // A bare cpio archive is the common uncompressed case.
  if (buf.subarray(0, 6).toString("ascii") === "070701") return "none";
  return "unknown";
}

/** Android boot images are identified by the magic at offset 0 (boot v3+) or
 *  at offset 8 (boot v0-v2, where it follows the kernel load address). */
export function detectKind(buf: Buffer): { kind: BootKind; headerVersion?: number } {
  if (buf.length < 16) return { kind: "unknown" };
  const magic = buf.readUInt32LE(0);

  // boot v3/v4 and vendor_boot v3/v4 all use the "ANDROID!" magic at offset 0,
  // but they declare their version at different offsets, and the field order
  // between them differs. Distinguishing them is a matter of reading the right
  // slot, not guessing:
  //
  //   boot         offset 8 = kernel_size, 12 = ramdisk_size, 28 = header_version
  //   vendor_boot  offset 8 = header_version, 12 = page_size, 16 = ramdisk_size
  //
  // So: read offset 8. A plausible page size there (2048/4096/16384) with a
  // small version at offset 12 means vendor_boot. A header_version of 3 or 4 at
  // offset 28 with a page size at 12 means boot.
  if (magic === 0x414e4452 || buf.subarray(0, 8).toString("ascii") === "ANDROID!") {
    if (buf.length < 32) return { kind: "unknown" };

    const at8 = buf.readUInt32LE(8);
    const at12 = buf.readUInt32LE(12);
    const at28 = buf.readUInt32LE(28);

    const vendorBootPage = at12;
    const looksVendorBoot =
      (at8 === 3 || at8 === 4) &&
      (vendorBootPage === 2048 || vendorBootPage === 4096 || vendorBootPage === 8192 || vendorBootPage === 16384);

    if (looksVendorBoot) return { kind: "vendor_boot", headerVersion: at8 };

    if (at28 === 3 || at28 === 4) return { kind: "boot", headerVersion: at28 };

    // Fall back to the older reading for anything unusual, but say so.
    const hv = at12;
    if (hv >= 3 && hv <= 4) return { kind: "boot", headerVersion: hv };
    return { kind: "unknown", headerVersion: hv };
  }

  // boot v0-v2: 8-byte kernel size, 8-byte address, then "ANDROID!".
  if (buf.length >= 16 && buf.subarray(8, 16).toString("ascii").startsWith("ANDROID!")) {
    const size = buf.readUInt32LE(0);
    const versions: Array<[number, (b: Buffer) => boolean]> = [
      [2, (b) => b.length > 44 && b.readUInt32LE(40) === 0x00010000 && b.readUInt32LE(44) === 0x00010001],
      [1, (b) => b.readUInt32LE(40) !== 0 || b.length > 48],
      [0, () => true],
    ];
    for (const [v, test] of versions) {
      try {
        if (test(buf)) return { kind: "boot", headerVersion: v };
      } catch {
        /* a short buffer fails the test, which is the answer we want */
      }
    }
    return { kind: "boot", headerVersion: size ? 0 : 0 };
  }

  return { kind: "unknown" };
}

function readCString(buf: Buffer, offset: number, max: number): string {
  const end = Math.min(buf.length, offset + max);
  let stop = offset;
  while (stop < end && buf[stop] !== 0) stop++;
  return buf.subarray(offset, stop).toString("utf-8");
}

function align(n: number, to: number): number {
  if (to <= 1) return n;
  return Math.ceil(n / to) * to;
}

/** Decode the packed os_version word used by boot v1+. */
function decodeOsVersion(v: number) {
  const a = (v >>> 25) & 0x7f;
  const b = (v >>> 18) & 0x7f;
  const c = (v >>> 11) & 0x7f;
  const year = ((v >>> 4) & 0x7f) + 2000;
  const month = v & 0xf;
  return { major: a, minor: b, patch: c, year, month };
}

/**
 * Parse a boot or vendor_boot image.
 *
 * Throws only when the buffer is not a recognisable image at all; a recognised
 * image with unusual fields returns warnings instead, because a half-understood
 * image is still more useful than a refusal.
 */
export function parseBootImage(buf: Buffer): BootImageInfo {
  const det = detectKind(buf);
  if (det.kind === "unknown") {
    throw new Error("not an Android boot image: no ANDROID! magic at offset 0 or 8");
  }
  if (det.headerVersion !== undefined && det.headerVersion >= 4) {
    return det.kind === "vendor_boot" ? parseVendorBootV4(buf, det.headerVersion) : parseBootV3V4(buf, det.headerVersion);
  }
  if (det.headerVersion === 3) return parseBootV3V4(buf, 3);
  return parseBootLegacy(buf, det.headerVersion ?? 0);
}

function parseBootLegacy(buf: Buffer, hv: number): BootImageInfo {
  const warnings: string[] = [];
  const pageSize = buf.readUInt32LE(36) || 2048;
  const kernelSize = buf.readUInt32LE(8);
  const ramdiskSize = buf.readUInt32LE(16);
  const secondSize = hv >= 1 ? buf.readUInt32LE(24) : 0;

  const headerPages = align(hv === 0 ? 1632 : hv === 1 ? 1648 : 1660, pageSize);
  const kernelOffset = headerPages;
  const ramdiskOffset = kernelOffset + align(kernelSize, pageSize);
  const secondOffset = ramdiskOffset + align(ramdiskSize, pageSize);

  const kernel = buf.subarray(kernelOffset, kernelOffset + kernelSize);
  const ramdisk = buf.subarray(ramdiskOffset, ramdiskOffset + ramdiskSize);
  const second = secondSize ? buf.subarray(secondOffset, secondOffset + secondSize) : undefined;

  const osVersion = hv >= 1 && buf.length >= 48 ? decodeOsVersion(buf.readUInt32LE(44)) : undefined;
  const cmdline = readCString(buf, hv === 0 ? 64 : 64, 512);
  const boardName = readCString(buf, hv === 0 ? 576 : 608, hv === 0 ? 16 : 32);

  const info: BootImageInfo = {
    kind: "boot",
    headerVersion: hv,
    headerSize: headerPages,
    pageSize,
    kernel: { offset: kernelOffset, size: kernelSize, compression: sniffCompression(kernel) },
    ramdisk: { offset: ramdiskOffset, size: ramdiskSize, compression: sniffCompression(ramdisk) },
    second: second ? { offset: secondOffset, size: secondSize, compression: sniffCompression(second) } : undefined,
    osVersion,
    cmdline: cmdline || undefined,
    boardName: boardName || undefined,
    fragments: [],
    twoStageRamdisk: false,
    warnings,
    deviceHints: { summary: [] },
  };
  info.deviceHints = deriveHints(info);
  return info;
}

function parseBootV3V4(buf: Buffer, hv: number): BootImageInfo {
  const warnings: string[] = [];
  // boot v3 header: these offsets are fixed by AOSP's bootimg.h.
  const kernelSize = buf.readUInt32LE(8);
  const ramdiskSize = buf.readUInt32LE(12);
  const osVersion = decodeOsVersion(buf.readUInt32LE(16));
  const headerSize = buf.readUInt32LE(20);
  const reserved0to3 = buf.readUInt32LE(24);
  const headerVersion = buf.readUInt32LE(28);
  const cmdline = readCString(buf, 44, 1536);

  // v3 has no page size field; images are aligned to 4096. v4 declares it.
  let pageSize = 4096;
  if (hv >= 4 && buf.length >= 1580) pageSize = buf.readUInt32LE(44 + 1536 + 4) || 4096;
  if (hv >= 4) {
    const declared = buf.readUInt32LE(1568);
    if (declared > 0) pageSize = declared;
  }

  const kernelOffset = align(headerSize || (hv >= 4 ? 1580 : 1580), pageSize);
  const ramdiskOffset = kernelOffset + align(kernelSize, pageSize);

  const kernel = buf.subarray(kernelOffset, kernelOffset + kernelSize);
  const ramdisk = buf.subarray(ramdiskOffset, ramdiskOffset + ramdiskSize);

  if (reserved0to3 !== 0) warnings.push(`unexpected reserved field at offset 24: 0x${reserved0to3.toString(16)}`);
  if (headerVersion !== hv) warnings.push(`header claims version ${headerVersion}, detected ${hv}`);

  const info: BootImageInfo = {
    kind: kernelSize === 0 ? "init_boot" : "boot",
    headerVersion: hv,
    headerSize: align(headerSize || 1580, pageSize),
    pageSize,
    kernel: { offset: kernelOffset, size: kernelSize, compression: sniffCompression(kernel) },
    ramdisk: { offset: ramdiskOffset, size: ramdiskSize, compression: sniffCompression(ramdisk) },
    osVersion,
    cmdline: cmdline || undefined,
    fragments: [],
    twoStageRamdisk: false,
    warnings,
    deviceHints: { summary: [] },
  };
  info.deviceHints = deriveHints(info);
  return info;
}

function parseVendorBootV4(buf: Buffer, hv: number): BootImageInfo {
  const warnings: string[] = [];
  const version = buf.readUInt32LE(8);
  const pageSize = buf.readUInt32LE(12) || 2048;
  const vendorRamdiskSize = buf.readUInt32LE(16);
  const cmdline = readCString(buf, 24, 2048);
  const tagsOffset = 24 + 2048;
  const tagsSize = buf.readUInt32LE(tagsOffset) || 0;
  const nameOffset = tagsOffset + 4;
  const productName = readCString(buf, nameOffset, 64);

  // Header v4 adds a fragment table after the v3 header.
  const V3_HEADER_SIZE = 2112;
  const fragmentCount = hv >= 4 && buf.length >= V3_HEADER_SIZE + 4 ? buf.readUInt32LE(V3_HEADER_SIZE) : 0;

  const fragments: RamdiskFragment[] = [];
  let tableOffset = V3_HEADER_SIZE + 4;
  for (let i = 0; i < fragmentCount; i++) {
    if (tableOffset + 108 > buf.length) {
      warnings.push(`fragment table truncated after ${i} of ${fragmentCount} entries`);
      break;
    }
    fragments.push({
      name: readCString(buf, tableOffset, 32),
      offset: buf.readUInt32LE(tableOffset + 32),
      size: buf.readUInt32LE(tableOffset + 36),
      compression: "unknown",
    });
    tableOffset += 108;
  }

  const ramdiskStart = align(V3_HEADER_SIZE + 4 + fragmentCount * 108, pageSize);
  const ramdisk = buf.subarray(ramdiskStart, ramdiskStart + vendorRamdiskSize);

  // Sniff each fragment from its declared offset, which is relative to the
  // ramdisk area rather than to the file.
  for (const f of fragments) {
    const abs = ramdiskStart + f.offset;
    if (abs < buf.length) f.compression = sniffCompression(buf.subarray(abs, Math.min(buf.length, abs + 8)));
    if (f.size === 0) warnings.push(`fragment ${f.name || `#${fragments.indexOf(f)}`} is empty`);
  }

  const info: BootImageInfo = {
    kind: "vendor_boot",
    headerVersion: hv,
    headerSize: ramdiskStart,
    pageSize,
    kernel: { offset: 0, size: 0, compression: "none" },
    ramdisk: { offset: ramdiskStart, size: vendorRamdiskSize, compression: sniffCompression(ramdisk) },
    cmdline: cmdline || undefined,
    productName: productName || undefined,
    fragments,
    twoStageRamdisk: fragments.length > 0,
    warnings,
    deviceHints: { summary: [] },
  };
  info.deviceHints = deriveHints(info);
  return info;
}

/**
 * Turn header facts into build hints. This is the part that means the user does
 * not have to know anything: the image itself says which kernel and ROM shape
 * the device needs.
 */
export function deriveHints(info: BootImageInfo): DeviceHints {
  const summary: string[] = [];
  const hints: DeviceHints = { summary };

  const v = info.osVersion;
  if (v && v.major > 0) {
    summary.push(`Android ${v.major}.${v.minor}.${v.patch} (built ${v.year}-${String(v.month).padStart(2, "0")})`);
  }

  // Arch: an arm64 kernel image carries the ARM64 boot protocol magic at a
  // fixed offset, and an x86 bzImage has "HdrS" near the front.
  const p = info.pageSize;
  if (p) {
    hints.pageSize = p;
    summary.push(`page size ${p}`);
  }

  if (info.kind === "vendor_boot") {
    hints.hasVendorBoot = true;
    if (info.twoStageRamdisk) {
      summary.push(
        `${info.fragments.length} vendor ramdisk fragment(s): the second-stage ramdisk is in vendor_boot, not boot.img`,
      );
    } else {
      summary.push("vendor_boot present with a single ramdisk");
    }
  }

  if (info.kind === "init_boot") {
    hints.hasInitBoot = true;
    summary.push("init_boot partition: Android 13+ layout, generic ramdisk is separate from the kernel");
  }

  if (info.headerVersion >= 3) {
    hints.gkiGeneration = info.headerVersion >= 4 ? "gki-2.0" : "gki-2.0";
    summary.push(
      info.headerVersion >= 4
        ? "header v4 — a GKI-era image (Android 12+), so kernel and vendor ramdisk are separately replaceable"
        : "header v3 — a GKI-era image (Android 11+), vendor_boot carries the board-specific ramdisk",
    );
  } else if (info.headerVersion <= 2) {
    hints.gkiGeneration = "pre-gki";
    summary.push("legacy header (v0-v2) — pre-GKI: kernel and ramdisk are welded into one boot.img");
  }

  if (info.productName) summary.push(`product: ${info.productName}`);
  if (info.boardName) summary.push(`board: ${info.boardName}`);
  if (info.cmdline) {
    summary.push(`cmdline: ${info.cmdline.slice(0, 120)}${info.cmdline.length > 120 ? "…" : ""}`);
    const console = info.cmdline.match(/console=ttyMSM(\d+)/);
    if (console) hints.socHint = `Qualcomm MSM, console ttyMSM${console[1]}`;
  }

  if (info.warnings.length) {
    for (const w of info.warnings) summary.push(`warning: ${w}`);
  }
  return hints;
}
