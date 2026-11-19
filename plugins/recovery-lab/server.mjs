/**
 * Recovery Lab.
 *
 * Two recovery families are modelled, because they are built differently:
 *
 *   OrangeFox  a fork of TWRP with a device tree under `device/<vendor>/<codename>`.
 *              The build is `./build.sh <device> <variant>` from a checked-out
 *              OrangeFox tree. The device tree supplies `BoardConfig.mk`,
 *              `twrp.fstab`, and the recovery UI flags.
 *   GearLock   a NetHunter/AnyRealm sidecar: it installs a boot environment
 *              (GearLock loader + recovery loader) rather than building a full
 *              TWRP image. Its unit is a `gearlock/` directory plus a kernel
 *              command line and an fstab, not a BoardConfig.
 *
 * Cross-porting is the interesting part and the part that goes wrong silently:
 * moving device A's recovery environment onto device B means the fstab, the
 * kernel cmdline, the partition names and the init rc all have to agree. A port
 * that copies files without checking those produces a tree that builds and then
 * cannot mount /data.
 *
 * So the lab's output is not just a file list. It is a compatibility report:
 * what matched, what did not, and the exact edits a human has to make.
 */

import fs from "fs";
import path from "path";

/** Fstab entries, normalised. The comparison unit for a cross-port. */
function parseFstab(text) {
  const rows = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const f = line.split(/\s+/);
    if (f.length < 3) continue;
    rows.push({
      mount: f[0],
      fstype: f[1],
      device: f[2],
      flags: f.slice(3).join(" ") || "",
      original: line,
    });
  }
  return rows;
}

/** BoardConfig variables we care about, as a flat map. */
function parseBoardConfig(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*export\s+/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_]+)\s*[:+?]?=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const RECOVERY_KEYS = [
  "TW_THEME",
  "TW_SCREEN_BLANK_ON_BOOT",
  "TW_USE_TOOLBOX",
  "TW_INCLUDE_CRYPTO",
  "TW_INCLUDE_FUSE_EXFAT",
  "TW_INCLUDE_NTFS_3G",
  "TW_EXCLUDE_TWRPAPP",
  "TW_HAS_NO_RECOVERY_PARTITION",
  "OF_USE_MAGISK_BOOT_SIGNED",
  "OF_DISABLE_MIUI_OTA_BY_DEFAULT",
  "OF_QUICK_BACKUP_LIST",
  "TARGET_RECOVERY_PIXEL_FORMAT",
  "TARGET_OTA_ASSERT_DEVICE",
  "TARGET_ARCH",
  "TARGET_ARCH_VARIANT",
  "TARGET_CPU_VARIANT",
  "BOARD_KERNEL_CMDLINE",
  "BOARD_KERNEL_BASE",
  "BOARD_KERNEL_PAGESIZE",
  "DEVICE_PATH",
  "DEVICE_RESOLUTION",
  "RECOVERY_SDCARD_ON_DATA",
];

/**
 * The per-device recipe. Split out so a user can supply their own profile
 * instead of only picking from a built-in list.
 */
const PROFILES = {
  "genevn": {
    vendor: "motorola",
    codename: "genevn",
    family: "yume",
    soc: "sm6450",
    arch: "arm64",
    recoveryPartition: "recovery",
    aOnly: true,
    abSlot: false,
    partitions: ["system", "vendor", "product", "data", "cache", "metadata", "boot", "recovery", "dtbo", "super"],
  },
  "E1404FA": {
    vendor: "asus",
    codename: "E1404FA",
    family: "vivobook-go-14",
    soc: "ryzen 5 7520U (mendocino)",
    arch: "x86_64",
    recoveryPartition: null,
    aOnly: true,
    abSlot: false,
    partitions: ["system", "data", "boot", "efi"],
  },
};

export async function register(ctx) {
  ctx.route("/catalog", (_req, res) => {
    res.json({
      families: [
        {
          id: "orangefox",
          name: "OrangeFox",
          lineage: "TWRP fork",
          unit: "device/<vendor>/<codename>",
          buildEntry: "./build.sh <device> <variant>",
          requires: ["BoardConfig.mk", "twrp.fstab (or recovery.fstab)", "device.mk"],
          files: {
            "device/<vendor>/<codename>/BoardConfig.mk": "# TARGET_ARCH, BOARD_KERNEL_CMDLINE, partition sizes, TW_* flags\n",
            "device/<vendor>/<codename>/device.mk": "# PRODUCT_* and the recovery package list\n",
            "device/<vendor>/<codename>/recovery.fstab": "# mount  fstype  device  flags\n",
            "device/<vendor>/<codename>/AndroidProducts.mk": "# lunch targets\n",
            "device/<vendor>/<codename>/vendorsetup.sh": "# add_lunch_combo\n",
          },
        },
        {
          id: "gearlock",
          name: "GearLock",
          lineage: "NetHunter boot environment sidecar",
          unit: "gearlock/",
          buildEntry: "pack the gearlock/ dir plus the kernel cmdline into the boot env",
          requires: ["gearlock/", "fstab", "cmdline"],
          files: {
            "gearlock/init.sh": "#!/system/bin/sh\n# GearLock entry point\n",
            "gearlock/fstab": "# mount  fstype  device  flags\n",
            "gearlock/cmdline": "# kernel cmdline the loader appends\n",
          },
        },
      ],
      profiles: Object.entries(PROFILES).map(([id, p]) => ({ id, ...p })),
      crossPortDimensions: [
        "fstab mount points and their device nodes",
        "boot/recovery partition names (A-only vs A/B)",
        "kernel cmdline (console, androidboot.*, dm-verity flags)",
        "TARGET_OTA_ASSERT_DEVICE must name this device, not the donor",
        "TARGET_RECOVERY_PIXEL_FORMAT must match the panel",
        "board kernel base and pagesize",
      ],
    });
  });

  /**
   * Compare a donor recovery environment with a target device profile. This is
   * the cross-port analysis: no files are copied, only disagreements named.
   */
  ctx.route("/crossport", (req, res) => {
    const { donorFstab = "", donorBoardConfig = "", targetProfile = "", targetFstab = "", targetBoardConfig = "" } = req.body ?? {};

    const profile = PROFILES[String(targetProfile)];
    if (!profile) {
      return res.status(400).json({ error: `unknown target profile "${targetProfile}"`, available: Object.keys(PROFILES) });
    }

    const donor = { fstab: parseFstab(String(donorFstab)), board: parseBoardConfig(String(donorBoardConfig)) };
    const target = { fstab: parseFstab(String(targetFstab)), board: parseBoardConfig(String(targetBoardConfig)) };

    const report = { targetProfile: profile, donor: {}, target: {}, conflicts: [], warnings: [], ok: [] };

    // --- fstab ---------------------------------------------------------------
    const dByMount = new Map(donor.fstab.map((r) => [r.mount, r]));
    const tByMount = new Map(target.fstab.map((r) => [r.mount, r]));

    report.donor.fstabMounts = [...dByMount.keys()];
    report.target.fstabMounts = [...tByMount.keys()];

    for (const [mount, d] of dByMount) {
      const t = tByMount.get(mount);
      if (!t) {
        report.conflicts.push({
          area: "fstab",
          mount,
          problem: `donor mounts ${mount} but the target fstab has no entry`,
          donor: d.original,
          fix: `add a ${mount} line to the target fstab, or remove it from the port if the device has no such mount`,
        });
        continue;
      }
      if (d.fstype !== t.fstype) {
        report.conflicts.push({
          area: "fstab",
          mount,
          problem: `${mount} fstype differs: donor ${d.fstype}, target ${t.fstype}`,
          donor: d.original,
          target: t.original,
          fix: "use the target's fstype; the donor's kernel may have a filesystem the target lacks",
        });
      }
      const dDev = d.device.replace(/\/dev\/block\/[^/]+\//g, "");
      const tDev = t.device.replace(/\/dev\/block\/[^/]+\//g, "");
      if (dDev !== tDev) {
        report.warnings.push({
          area: "fstab",
          mount,
          problem: `device node differs: donor ${d.device}, target ${t.device}`,
          note: "usually correct to keep the target's node; by-name is preferred over by-number",
        });
      }
      if (d.fstype === t.fstype && dDev === tDev) {
        report.ok.push(`fstab ${mount}: compatible`);
      }
    }

    for (const [mount] of tByMount) {
      if (!dByMount.has(mount)) {
        report.warnings.push({
          area: "fstab",
          mount,
          problem: `target mounts ${mount} but the donor has no entry`,
          note: "the port is additive here; nothing to change, but the recovery will see a mount the donor build did not",
        });
      }
    }

    // --- board config --------------------------------------------------------
    for (const key of RECOVERY_KEYS) {
      const d = donor.board[key];
      const t = target.board[key];
      if (d === undefined && t === undefined) continue;
      if (d === undefined) {
        report.warnings.push({ area: "BoardConfig", key, problem: `donor does not set ${key}; target sets "${t}"` });
        continue;
      }
      if (t === undefined) {
        report.conflicts.push({
          area: "BoardConfig",
          key,
          problem: `donor sets ${key}="${d}" but the target device tree does not set it at all`,
          fix: `carry ${key} across only if it is device-neutral; device-specific values must be re-derived`,
        });
        continue;
      }
      if (d !== t) {
        const deviceSpecific = ["BOARD_KERNEL_CMDLINE", "BOARD_KERNEL_BASE", "DEVICE_RESOLUTION", "TARGET_OTA_ASSERT_DEVICE", "TARGET_RECOVERY_PIXEL_FORMAT", "TARGET_CPU_VARIANT"];
        const isDeviceSpecific = deviceSpecific.includes(key);
        (isDeviceSpecific ? report.conflicts : report.warnings).push({
          area: "BoardConfig",
          key,
          problem: `${key} differs: donor "${d}", target "${t}"`,
          fix: isDeviceSpecific
            ? "device-specific — keep the target's value, do not port the donor's"
            : "cosmetic or product-level — either value works, prefer the target's",
        });
      } else {
        report.ok.push(`BoardConfig ${key}: identical`);
      }
    }

    // --- partition-name sanity ----------------------------------------------
    if (profile.recoveryPartition === null) {
      report.warnings.push({
        area: "profile",
        problem: `${profile.codename} has no separate recovery partition (${profile.arch})`,
        note: "a recovery image for this device has nowhere to live; it is a boot-environment sidecar, not a flashed partition",
      });
    }
    if (profile.abSlot) {
      report.warnings.push({ area: "profile", problem: "A/B device: recovery is inside boot.img, and flashing recovery alone will not boot" });
    }

    report.summary = {
      conflicts: report.conflicts.length,
      warnings: report.warnings.length,
      compatible: report.ok.length,
      verdict:
        report.conflicts.length === 0
          ? "portable: no blocking difference"
          : `not portable as-is: ${report.conflicts.length} blocking difference(s)`,
    };

    res.json(report);
  });

  /** The tree a build expects, as real files, filled from a device profile. */
  ctx.route("/scaffold", (req, res) => {
    const { profileId = "", family = "orangefox" } = req.body ?? {};
    const p = PROFILES[String(profileId)];
    if (!p) return res.status(400).json({ error: `unknown profile "${profileId}"`, available: Object.keys(PROFILES) });

    const root = family === "gearlock" ? "gearlock" : path.posix.join("device", p.vendor, p.codename);

    const fstabLines = p.partitions
      .map((part) => {
        const fstype = part === "boot" || part === "recovery" || part === "dtbo" ? "emmc" : part === "data" ? "f2fs" : part === "efi" ? "vfat" : "ext4";
        const dev = `/dev/block/bootdevice/by-name/${part}`;
        return `${dev.padEnd(44)} ${fstype.padEnd(6)} /${part === "data" ? "data" : part} ${part === "data" ? "flags=encryptable=footer" : ""}`.trimEnd();
      })
      .join("\n");

    const board =
      family === "gearlock"
        ? `# GearLock environment for ${p.codename}
# Device: ${p.vendor} ${p.codename} (${p.soc}, ${p.arch})
GEARLOCK_DEVICE=${p.codename}
GEARLOCK_ARCH=${p.arch}
GEARLOCK_MOUNT_ROOT=/${p.partitions[0]}
`
        : `# OrangeFox device tree — ${p.vendor} ${p.codename}
# Generated by AnyRealm Recovery Lab. Every value here is device-specific:
# do not carry any of it to another device without re-deriving it.

DEVICE_PATH := device/${p.vendor}/${p.codename}

TARGET_ARCH := ${p.arch === "x86_64" ? "x86_64" : "arm64"}
TARGET_OTA_ASSERT_DEVICE := ${p.codename}

# Kernel geometry — must match this device's boot header
BOARD_KERNEL_PAGESIZE := ${p.arch === "x86_64" ? "4096" : "2048"}
BOARD_KERNEL_BASE := 0x${p.arch === "x86_64" ? "10000000" : "00000000"}
BOARD_KERNEL_CMDLINE := console=ttyMSM0,115200n8 androidboot.hardware=${p.codename}

# Partitions
${p.partitions
  .map((part) => `BOARD_${part.toUpperCase()}_FILE_SYSTEM_TYPE := ${part === "data" ? "f2fs" : part === "efi" ? "vfat" : "ext4"}`)
  .join("\n")}

# Theme / UI
TW_THEME := portrait_hdpi
TW_SCREEN_BLANK_ON_BOOT := true
TW_INCLUDE_CRYPTO := true
TARGET_RECOVERY_PIXEL_FORMAT := RGBX_8888

# OrangeFox
OF_QUICK_BACKUP_LIST := /boot;/data;
OF_USE_MAGISK_BOOT_SIGNED := true
`;

    const files = [
      { path: path.posix.join(root, family === "gearlock" ? "fstab" : "recovery.fstab"), contents: fstabLines + "\n" },
      { path: path.posix.join(root, family === "gearlock" ? "device.prop" : "BoardConfig.mk"), contents: board },
    ];

    if (family === "orangefox") {
      files.push(
        {
          path: path.posix.join(root, "device.mk"),
          contents: `LOCAL_PATH := device/${p.vendor}/${p.codename}

PRODUCT_MAKEFILES := \\
    $(LOCAL_DIR)/twrp_${p.codename}.mk

COMMON_LUNCH_CHOICES := \\
    twrp_${p.codename}-eng
`,
        },
        {
          path: path.posix.join(root, "twrp_${p.codename}.mk".replace("${p.codename}", p.codename)),
          contents: `$(call inherit-product, $(SRC_TARGET_DIR)/product/core_64_bit.mk)
$(call inherit-product, $(SRC_TARGET_DIR)/product/base.mk)
$(call inherit-product, vendor/twrp/config/common.mk)
$(call inherit-product, device/${p.vendor}/${p.codename}/device.mk)

PRODUCT_DEVICE := ${p.codename}
PRODUCT_NAME := twrp_${p.codename}
PRODUCT_BRAND := ${p.vendor}
PRODUCT_MODEL := ${p.codename}
PRODUCT_MANUFACTURER := ${p.vendor}
`,
        },
        {
          path: path.posix.join(root, "vendorsetup.sh"),
          contents: `add_lunch_combo twrp_${p.codename}-eng\n`,
        },
      );
    } else {
      files.push(
        { path: path.posix.join(root, "init.sh"), contents: `#!/system/bin/sh\n# GearLock entry point for ${p.codename}\n` },
        { path: path.posix.join(root, "cmdline"), contents: `androidboot.hardware=${p.codename}\n` },
      );
    }

    res.json({ ok: true, profileId, family, root, files });
  });
}

export function workflowSnippet(body) {
  const family = String(body?.family ?? "orangefox");
  const device = String(body?.codename ?? body?.profileId ?? "device").replace(/[^A-Za-z0-9._-]/g, "_");
  if (family === "gearlock") {
    return [
      `      - name: Pack GearLock environment (${device})`,
      `        run: |`,
      `          set -euo pipefail`,
      `          test -f device/${device}/gearlock/init.sh`,
      `          tar -czf gearlock-${device}.tar.gz -C device/${device} gearlock`,
    ].join("\n");
  }
  return [
    `      - name: Build OrangeFox recovery (${device})`,
    `        run: |`,
    `          set -euo pipefail`,
    `          test -f device/*/${device}/BoardConfig.mk`,
    `          ./build.sh ${device} eng`,
  ].join("\n");
}

export const exports = { catalog: "/catalog", crossport: "/crossport", scaffold: "/scaffold" };
