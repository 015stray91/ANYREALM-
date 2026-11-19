/**
 * Partition catalog for real partition dumps.
 *
 * A dump like the one from a Moto/Qualcomm device is not "some firmware images".
 * It is three full snapshots, each a set of partitions named
 * `<partition>_<slot>?_backup_<timestamp>.<container>`, and every partition in it
 * needs different treatment:
 *
 *   boot / vendor_boot / dtbo / recovery   Android images with a header. Parsed,
 *                                         unpacked into kernel+ramdisk, repacked.
 *   super                                  dynamic partition metadata; needs
 *                                         lpunpack before anything inside exists.
 *   xbl / abl / tz / hyp / keymaster …     signed ELF or TrustZone blobs. There
 *                                         is no filesystem and no unpack. They are
 *                                         copied back byte-for-byte or not at all.
 *   modem / fsg / prov / persist           vendor data blobs, also opaque.
 *   metadata / misc / secdata              small raw regions.
 *
 * The last group is the one people get wrong: an "unpack" of `tz.img` produces
 * noise, and a "repack" of it produces a brick, because the signature only
 * validates the exact bytes the vendor shipped. This module says so per
 * partition instead of offering one generic extract button.
 *
 * Container is orthogonal to partition: the same partition may be
 * `_backup_...tar.gz`, `_backup_....img`, or bare. The catalog separates the two
 * axes so a file can be classified without knowing either in advance.
 */

export type PartitionClass =
  | "android-image"
  | "dynamic-super"
  | "firmware-blob"
  | "vendor-data"
  | "filesystem"
  | "raw-region"
  | "unknown";

export interface PartitionSpec {
  name: string;
  cls: PartitionClass;
  /** What it actually is, in one line. */
  what: string;
  /** How to look at it. Empty when there is nothing to look at. */
  inspect: string[];
  /** How to unpack it. Empty when unpacking is meaningless. */
  unpack: string[];
  /**
   * How to put it back. `"keep-original"` is a real answer: it means the only
   * safe repack is no repack.
   */
  repack: string[] | "keep-original" | null;
  repackNote?: string;
  /** Restoring it wrong bricks the device or breaks verified boot. */
  critical: boolean;
  slot: "a" | "b" | "ab" | "none";
}

const SPECS: Omit<PartitionSpec, "slot">[] = [
  // ---- Android images: header + kernel + ramdisk ---------------------------
  {
    name: "boot",
    cls: "android-image",
    what: "kernel + ramdisk (header v3/v4 on this device)",
    inspect: ["file", "{in}"],
    unpack: ["unpackbootimg", "-i", "{in}", "-o", "{dir}"],
    repack: ["mkbootimg", "--config", "{dir}/bootimg.cfg", "-o", "{out}"],
    critical: true,
  },
  {
    name: "vendor_boot",
    cls: "android-image",
    what: "vendor ramdisk, v4 with named fragments (two-stage ramdisk)",
    inspect: ["file", "{in}"],
    unpack: ["unpackbootimg", "-i", "{in}", "-o", "{dir}"],
    repack: ["mkbootimg", "--config", "{dir}/bootimg.cfg", "-o", "{out}"],
    repackNote: "fragment order and names matter; mkbootimg --vendor_boot needs them in header order",
    critical: true,
  },
  {
    name: "init_boot",
    cls: "android-image",
    what: "generic ramdisk, separate from boot on Android 13+",
    inspect: ["file", "{in}"],
    unpack: ["unpackbootimg", "-i", "{in}", "-o", "{dir}"],
    repack: ["mkbootimg", "--config", "{dir}/bootimg.cfg", "-o", "{out}"],
    critical: true,
  },
  {
    name: "recovery",
    cls: "android-image",
    what: "recovery ramdisk (A/B devices usually keep it inside boot)",
    inspect: ["file", "{in}"],
    unpack: ["unpackbootimg", "-i", "{in}", "-o", "{dir}"],
    repack: ["mkbootimg", "--config", "{dir}/bootimg.cfg", "-o", "{out}"],
    critical: true,
  },
  {
    name: "dtbo",
    cls: "android-image",
    what: "device tree overlay table",
    inspect: ["mkdtimg", "dump", "{in}"],
    unpack: ["mkdtimg", "dump", "{in}", "-b", "{dir}/dtbo"],
    repack: ["mkdtimg", "create", "{out}", "--page_size", "2048", "{dir}/dtbo.*"],
    repackNote: "DT overlays are matched to the board by fdt index; order is part of the ABI",
    critical: true,
  },

  // ---- dynamic partitions --------------------------------------------------
  {
    name: "super",
    cls: "dynamic-super",
    what: "dynamic partition container (system/vendor/product/odm inside)",
    inspect: ["lpdump", "{in}"],
    unpack: ["lpunpack", "{in}", "{dir}"],
    repack: ["lpmake", "--metadata-size", "65536", "--super-name", "super", "--device-size", "{size}", "--output", "{out}", "{extents}"],
    repackNote: "needs the exact device size and an extent list from lpdump; this project already has LpmakeConfigGenerator for that",
    critical: true,
  },
  {
    name: "system",
    cls: "filesystem",
    what: "ext4 or erofs root filesystem",
    inspect: ["file", "{in}"],
    unpack: ["debugfs", "-R", "rdump / {dir}", "{in}"],
    repack: null,
    repackNote: "rebuild with mke2fs -d or mkfs.erofs, not a repack",
    critical: false,
  },

  // ---- opaque vendor blobs: look, do not touch -----------------------------
  {
    name: "xbl",
    cls: "firmware-blob",
    what: "Qualcomm bootloader stage 1 (signed ELF)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "signed. Any modification fails the signature check and the device does not boot.",
    critical: true,
  },
  {
    name: "xbl_config",
    cls: "firmware-blob",
    what: "bootloader configuration blob",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "signed alongside xbl; must come from the same build.",
    critical: true,
  },
  {
    name: "xbl_ramdump",
    cls: "firmware-blob",
    what: "bootloader crash dumper",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "abl",
    cls: "firmware-blob",
    what: "Android bootloader (signed ELF)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "signed; also enforces rollback protection against other partitions.",
    critical: true,
  },
  {
    name: "tz",
    cls: "firmware-blob",
    what: "TrustZone secure world image",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "no filesystem inside. 'Unpacking' it yields noise; repacking it yields a brick.",
    critical: true,
  },
  {
    name: "tzsc",
    cls: "firmware-blob",
    what: "TrustZone secure config",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "hyp",
    cls: "firmware-blob",
    what: "hypervisor image",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "aop",
    cls: "firmware-blob",
    what: "always-on processor firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "aop_config",
    cls: "firmware-blob",
    what: "AOP configuration",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "devcfg",
    cls: "firmware-blob",
    what: "device configuration (TZ access rules)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "keymaster",
    cls: "firmware-blob",
    what: "hardware keymaster / keystore TA",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "tied to this device's fused keys; another unit's copy will not work.",
    critical: true,
  },
  {
    name: "qupfw",
    cls: "firmware-blob",
    what: "QTI update firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "shrm",
    cls: "firmware-blob",
    what: "shared resource manager firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "cpucp",
    cls: "firmware-blob",
    what: "CPU control processor firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "uefi",
    cls: "firmware-blob",
    what: "UEFI firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "in practice a FAT image; inspect with 7z if you only want to look",
    critical: true,
  },
  {
    name: "uefisecapp",
    cls: "firmware-blob",
    what: "UEFI secure app",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "uefivarstore",
    cls: "firmware-blob",
    what: "UEFI variable store",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "storsec",
    cls: "firmware-blob",
    what: "storage security (ICE/rpmb keys)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "device-unique key material. Never copy another device's.",
    critical: true,
  },
  {
    name: "spunvm",
    cls: "firmware-blob",
    what: "secure processor VM image",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "qmcs",
    cls: "firmware-blob",
    what: "Qualcomm messaging/connection security",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "connsec",
    cls: "firmware-blob",
    what: "connectivity security blob",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "ssd",
    cls: "firmware-blob",
    what: "secure software download region",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "ddr",
    cls: "firmware-blob",
    what: "DDR training data",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "board-specific memory training",
    critical: true,
  },
  {
    name: "limits",
    cls: "firmware-blob",
    what: "thermal/power limits",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "limits-cdsp",
    cls: "firmware-blob",
    what: "CDSP thermal limits",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "dsp",
    cls: "firmware-blob",
    what: "audio/compute DSP firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "bluetooth",
    cls: "firmware-blob",
    what: "Bluetooth controller firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "modem",
    cls: "firmware-blob",
    what: "baseband/modem firmware",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "must match the carrier firmware set; a mismatch loses IMEI registration",
    critical: true,
  },
  {
    name: "fsg",
    cls: "vendor-data",
    what: "modem file system (golden copy)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "fsc",
    cls: "raw-region",
    what: "modem file system cache",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "modemst1",
    cls: "raw-region",
    what: "modem NV storage 1",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "device-unique. Restoring another device's copy changes the IMEI.",
    critical: true,
  },
  {
    name: "modemst2",
    cls: "raw-region",
    what: "modem NV storage 2",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "device-unique. See modemst1.",
    critical: true,
  },
  {
    name: "persist",
    cls: "vendor-data",
    what: "sensor calibration and factory data",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "losing this loses camera/sensor calibration permanently",
    critical: true,
  },
  {
    name: "prodpersist",
    cls: "vendor-data",
    what: "production persist data",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "prov",
    cls: "vendor-data",
    what: "provisioning data",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "carrier",
    cls: "vendor-data",
    what: "carrier configuration",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "utags",
    cls: "vendor-data",
    what: "unit tags (serial, model, region)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "device identity. Never merge across units.",
    critical: true,
  },
  {
    name: "utagsbackup",
    cls: "vendor-data",
    what: "backup of unit tags",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "cid",
    cls: "vendor-data",
    what: "carrier/region ID",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "devinfo",
    cls: "raw-region",
    what: "device info / lock state flags",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "holds the bootloader unlock state; writing it carelessly re-locks or bricks",
    critical: true,
  },
  {
    name: "apdp",
    cls: "raw-region",
    what: "automatic power-down protection data",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "apdpb",
    cls: "raw-region",
    what: "APDP backup copy",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "kpan",
    cls: "raw-region",
    what: "kernel panic log region",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "logfs",
    cls: "raw-region",
    what: "log filesystem region",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "metadata",
    cls: "raw-region",
    what: "encryption metadata (key blobs for /data)",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    repackNote: "wiping it makes /data unreadable; that is sometimes the point",
    critical: true,
  },
  {
    name: "misc",
    cls: "raw-region",
    what: "boot command/status region",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "secdata",
    cls: "raw-region",
    what: "security data region",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "secdatabackup",
    cls: "raw-region",
    what: "security data backup",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "frp",
    cls: "raw-region",
    what: "factory reset protection state",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: true,
  },
  {
    name: "pad",
    cls: "raw-region",
    what: "padding region",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "pad3",
    cls: "raw-region",
    what: "padding region 3",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "pad4",
    cls: "raw-region",
    what: "padding region 4",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },
  {
    name: "logo",
    cls: "raw-region",
    what: "boot logo bitmaps",
    inspect: ["file", "{in}"],
    unpack: [],
    repack: "keep-original",
    critical: false,
  },

  // ---- verified boot -------------------------------------------------------
  {
    name: "vbmeta",
    cls: "firmware-blob",
    what: "verified boot metadata (hash tree + flags)",
    inspect: ["avbtool", "info_image", "--image", "{in}"],
    unpack: [],
    repack: ["avbtool", "make_vbmeta_image", "--output", "{out}", "--flags", "2"],
    repackNote: "the flags field is what disables verification; changing it is what makes flashed images boot",
    critical: true,
  },
  {
    name: "vbmeta_system",
    cls: "firmware-blob",
    what: "verified boot metadata for the system chain",
    inspect: ["avbtool", "info_image", "--image", "{in}"],
    unpack: [],
    repack: ["avbtool", "make_vbmeta_image", "--output", "{out}"],
    critical: true,
  },
];

const BY_NAME = new Map(SPECS.map((s) => [s.name, s]));

/** Longest-name-first, so `xbl_config` is not matched as `xbl`. */
const NAMES_BY_LENGTH = [...SPECS].map((s) => s.name).sort((a, b) => b.length - a.length);

const CONTAINERS: Array<{ ext: string; id: string; inspect: string[]; unpack: string[]; tools: string[] }> = [
  { ext: ".tar.gz", id: "tar.gz", inspect: ["tar", "-tzf", "{in}"], unpack: ["tar", "-xzf", "{in}", "-C", "{dir}"], tools: ["tar", "gzip"] },
  { ext: ".tgz", id: "tar.gz", inspect: ["tar", "-tzf", "{in}"], unpack: ["tar", "-xzf", "{in}", "-C", "{dir}"], tools: ["tar", "gzip"] },
  { ext: ".tar", id: "tar", inspect: ["tar", "-tf", "{in}"], unpack: ["tar", "-xf", "{in}", "-C", "{dir}"], tools: ["tar"] },
  { ext: ".img", id: "raw", inspect: ["file", "{in}"], unpack: [], tools: ["file"] },
  { ext: ".bin", id: "raw", inspect: ["file", "{in}"], unpack: [], tools: ["file"] },
];

export interface ParsedName {
  /** As given. */
  fileName: string;
  /** Partition base name, or null when it does not look like a dump file. */
  partition: string | null;
  /** Slot marker found in the name, if any. */
  slot: "a" | "b" | "ab" | "none";
  /** Backup timestamp, ISO-ish, if present. */
  timestamp: string | null;
  /** Container by extension, or "none" for a bare file. */
  container: string;
  /** Everything a caller needs to act. */
  spec: PartitionSpec | null;
  notes: string[];
  warnings: string[];
}

/**
 * Parse `<partition>[_<slot>]_backup_<YYYY-MM-DD>_<HH-MM-SS>[.ext]` and the
 * plain `<partition>[_<slot>].img` form.
 *
 * The timestamp is the grouping key: three snapshots taken at different times
 * are three different backups, and mixing files across them is how a device ends
 * up with a modem from one build and a bootloader from another.
 */
export function parseDumpName(fileName: string): ParsedName {
  const notes: string[] = [];
  const warnings: string[] = [];
  const lower = fileName.toLowerCase();

  let container = "none";
  let base = fileName;
  for (const c of CONTAINERS) {
    if (lower.endsWith(c.ext)) {
      container = c.id;
      base = fileName.slice(0, -c.ext.length);
      break;
    }
  }
  if (container === "none" && fileName.includes(".")) {
    const ext = fileName.slice(fileName.lastIndexOf("."));
    notes.push(`unrecognised extension "${ext}" — will be sniffed from content`);
  }

  let timestamp: string | null = null;
  const ts = /_backup_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(base);
  if (ts) {
    timestamp = `${ts[1]}T${ts[2]}:${ts[3]}:${ts[4]}`;
    base = base.slice(0, ts.index);
  }

  let slot: ParsedName["slot"] = "none";
  let partition: string | null = null;

  const withSlot = /^(.+)_([ab])$/.exec(base);
  if (withSlot && BY_NAME.has(withSlot[1])) {
    partition = withSlot[1];
    slot = withSlot[2] as "a" | "b";
  } else if (BY_NAME.has(base)) {
    partition = base;
  } else {
    // Try longest known name as a prefix, which catches a stray suffix.
    for (const candidate of NAMES_BY_LENGTH) {
      if (base === candidate) {
        partition = candidate;
        break;
      }
      if (base.startsWith(`${candidate}_`)) {
        partition = candidate;
        notes.push(`matched partition "${candidate}" from prefix`);
        break;
      }
    }
  }

  if (!partition) {
    warnings.push("does not match a known partition name; treating as an opaque file");
    return { fileName, partition: null, slot: "none", timestamp, container, spec: null, notes, warnings };
  }

  const spec = BY_NAME.get(partition)!;
  const resolved: PartitionSpec = { ...spec, slot: slot === "none" ? "none" : slot };

  if (spec.cls === "firmware-blob" || spec.cls === "vendor-data" || spec.cls === "raw-region") {
    notes.push("opaque: there is nothing to unpack, and the original bytes are the only correct output");
  }
  if (spec.critical) {
    warnings.push("critical partition — a wrong write here bricks the device or breaks verified boot");
  }

  return { fileName, partition, slot, timestamp, container, spec: resolved, notes, warnings };
}

/** Group a whole directory listing by backup timestamp. */
export function groupSnapshots(files: string[]) {
  const parsed = files.map(parseDumpName);
  const byTime = new Map<string, ParsedName[]>();
  for (const p of parsed) {
    const key = p.timestamp ?? "(no timestamp)";
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key)!.push(p);
  }

  return [...byTime.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timestamp, items]) => {
      const partitions = items.filter((i) => i.partition);
      const byPartition = new Map<string, ParsedName[]>();
      for (const i of partitions) {
        if (!byPartition.has(i.partition!)) byPartition.set(i.partition!, []);
        byPartition.get(i.partition!)!.push(i);
      }
      return {
        timestamp,
        files: items.length,
        partitions: byPartition.size,
        // Two containers for the same partition in one snapshot is usually a
        // re-dump, not two partitions. Worth surfacing rather than hiding.
        duplicates: [...byPartition.entries()]
          .filter(([, v]) => v.length > 1)
          .map(([name, v]) => ({ partition: name, files: v.map((x) => x.fileName) })),
        criticalCount: partitions.filter((p) => p.spec?.critical).length,
        opaqueCount: partitions.filter((p) => p.spec && (p.spec.cls === "firmware-blob" || p.spec.cls === "vendor-data" || p.spec.cls === "raw-region")).length,
        unsupported: items.filter((i) => !i.partition).map((i) => i.fileName),
      };
    });
}

export function catalog() {
  return {
    classes: [
      { id: "android-image", label: "Android image", treat: "parse header, unpack kernel + ramdisk, repack with mkbootimg" },
      { id: "dynamic-super", label: "Dynamic super", treat: "lpdump to read, lpunpack to extract, lpmake to rebuild" },
      { id: "filesystem", label: "Filesystem", treat: "debugfs rdump / mkfs, not a repack" },
      { id: "firmware-blob", label: "Signed firmware", treat: "inspect only; repacking invalidates the signature" },
      { id: "vendor-data", label: "Vendor data", treat: "device-unique; preserve bytes exactly" },
      { id: "raw-region", label: "Raw region", treat: "read-only in practice" },
    ],
    partitions: SPECS.map((s) => ({
      name: s.name,
      cls: s.cls,
      what: s.what,
      critical: s.critical,
      canUnpack: s.unpack.length > 0,
      repack: s.repack === "keep-original" ? "keep-original" : s.repack ? "tool" : "rebuild",
      repackNote: s.repackNote ?? null,
      tools: [...new Set([...s.inspect, ...s.unpack].map((c) => c).filter((c) => c && !c.startsWith("{") && !c.startsWith("-")))],
    })),
    containers: CONTAINERS.map((c) => ({ id: c.id, extension: c.ext, tools: c.tools })),
  };
}

export const partitionSpecs = SPECS;
