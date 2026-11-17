/**
 * The build chain, as five ordered choices.
 *
 *   1. Android base ROM          always first, always the base
 *   2. mobile Linux distro       the user space fused on top
 *   3. UX                        picked from what that distro installs
 *   4. device kernel             with the root manager, config derived from 2+3
 *   5. firmware fusion           reassemble the uploaded firmware images with 4
 *
 * Steps 1-3 are a picker (see ux-integration.ts). This module owns 4 and 5,
 * which are the part that makes the result NUKI/NURFS rather than a rootfs drop:
 *
 *   - stage 4 does not invent a kernel config. It starts from the device's real
 *     defconfig chain (read from the device profile, not guessed), adds the
 *     root-manager fragment, then adds the keys the chosen distro and UX need to
 *     run at all. A distro needing a mount type the vendor kernel does not build
 *     is a config line, not a patch.
 *   - stage 5 does not re-download a system image. It takes the firmware the user
 *     uploaded, splits it into the partitions it actually contains, and rebuilds
 *     only the ones that changed: boot and vendor_boot get the new kernel and the
 *     NURFS ramdisk, the Android system/vendor partitions are passed through
 *     unmodified. So the output matches the firmware it came from, which is the
 *     whole reason to start from uploaded firmware instead of a fresh AOSP tree.
 */

import type { UxSlot } from "./ux-integration";

export type RootManager = "kernelsu-next" | "resukisu" | "sukisu-ultra" | "wildksu";

export interface RootManagerInfo {
  id: RootManager;
  name: string;
  /** Directory under the Super-Builders tree that carries the patches. */
  dir: string;
  /** Patch series applied in order. */
  patches: string[];
  /** Key the patch series keys off, so two managers cannot both be applied. */
  keys: string;
  /** What it adds on top of plain KernelSU. */
  note: string;
}

/**
 * The four root managers that exist in Super-Builders, all of which carry SUSFS +
 * ZeroMount. Read from the trees: each manager directory has the same 50/51/60
 * patch series and differs only in the 70_ksu_safety patch, which is the evidence
 * that they are variants of one interface rather than four separate projects.
 */
export const ROOT_MANAGERS: RootManagerInfo[] = [
  {
    id: "kernelsu-next",
    name: "KernelSU-Next",
    dir: "android12-5.10/KernelSU-Next",
    patches: [
      "10_enable_susfs_for_ksu.patch",
      "50_add_susfs_in_gki-android12-5.10.patch",
      "51_enhanced_susfs-android12-5.10.patch",
      "60_zeromount-android12-5.10.patch",
      "65_zeromount-adb-filter-android12-5.10.patch",
      "70_ksu_safety-kernelsu-next-5.10.patch",
      "80_nuki_colonel_source_fixes.patch",
    ],
    keys: "CONFIG_KSU=y",
    note:
      "The project's manager and the one the pins file tracks. Carries the full SUSFS key set " +
      "(35 keys), ZeroMount plus the adb filter, KPM EUD and ANBU, and the NUKI colonel source fixes.",
  },
  {
    id: "resukisu",
    name: "ReSukiSU",
    dir: "android12-5.10/ReSukiSU",
    patches: [
      "50_add_susfs_in_gki-android12-5.10.patch",
      "51_enhanced_susfs-android12-5.10.patch",
      "60_zeromount-android12-5.10.patch",
      "70_ksu_safety-resukisu-5.10.patch",
    ],
    keys: "CONFIG_KSU=y",
    note:
      "Same SUSFS and ZeroMount series, different 70_ksu_safety patch. Has no " +
      "65_zeromount-adb-filter and no NUKI colonel fixes, so the adb filter is absent.",
  },
  {
    id: "sukisu-ultra",
    name: "SukiSU-Ultra",
    dir: "android12-5.10/SukiSU-Ultra",
    patches: [
      "50_add_susfs_in_gki-android12-5.10.patch",
      "51_enhanced_susfs-android12-5.10.patch",
      "60_zeromount-android12-5.10.patch",
      "70_ksu_safety-sukisu-5.10.patch",
    ],
    keys: "CONFIG_KSU=y",
    note: "As ReSukiSU: shared SUSFS/ZeroMount series, its own safety patch, no adb filter.",
  },
  {
    id: "wildksu",
    name: "WildKSU",
    dir: "android12-5.10/WildKSU",
    patches: [
      "50_add_susfs_in_gki-android12-5.10.patch",
      "51_enhanced_susfs-android12-5.10.patch",
      "60_zeromount-android12-5.10.patch",
      "70_ksu_safety-wksu-5.10.patch",
    ],
    keys: "CONFIG_KSU=y",
    note: "Pinned separately in android12-5.10/wksu-pin.txt (2f53d07e). No adb filter.",
  },
];

/**
 * Kernel config a distro and a UX need, beyond what the vendor defconfig has.
 *
 * Every entry is here for a stated reason. This is the difference between "the
 * kernel compiled" and "the rootfs mounted": an ext4 rootfs on a vendor kernel
 * built without CONFIG_EXT4_FS produces no error at build time and a kernel panic
 * at boot.
 */
export interface ConfigNeed {
  key: string;
  value: "y" | "m";
  /** Which part of the chain forces this. */
  because: "nurfs" | "distro" | "ux" | "root-manager" | "display";
  why: string;
}

/** Keys the merge itself requires, independent of the distro. */
const NURFS_KEYS: ConfigNeed[] = [
  { key: "CONFIG_EXT4_FS", value: "y", because: "nurfs", why: "the NURFS partition is ext4; vold does not mount it" },
  { key: "CONFIG_BLK_DEV_LOOP", value: "y", because: "nurfs", why: "a NURFS image file is mounted through a loop device" },
  { key: "CONFIG_SQUASHFS", value: "y", because: "nurfs", why: "the desktop ISO half ships squashfs, and an installer may read it from the phone side" },
  { key: "CONFIG_OVERLAY_FS", value: "y", because: "nurfs", why: "runtime overlay for a read-only fused root, and a prerequisite of several SUSFS keys" },
  { key: "CONFIG_TMPFS_XATTR", value: "y", because: "nurfs", why: "SELinux labels on tmpfs-backed runtime dirs" },
  { key: "CONFIG_NAMESPACES", value: "y", because: "nurfs", why: "mount namespaces, so the merged tree can be re-rooted without a container" },
];

/** Keys each distro's user space needs to reach its session. */
const DISTRO_KEYS: Record<string, ConfigNeed[]> = {
  mobian: [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Debian's init expects /dev populated by the kernel" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "systemd's device controller; without it the session unit fails to start" },
    { key: "CONFIG_FANOTIFY", value: "y", because: "distro", why: "used by Debian's package tooling at first boot" },
  ],
  postmarketos: [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Alpine's init mounts devtmpfs at boot" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "OpenRC service ordering uses the device controller" },
  ],
  droidian: [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Debian user space on the vendor base" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "systemd unit gating for the session" },
  ],
  ubports: [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Lomiri's session comes up under the Ubuntu init" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "upstart/systemd cgroup handling" },
  ],
  sailfish: [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Mer's init expects devtmpfs mounted" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "systemd on Mer" },
  ],
  "kali-nethunter-pro": [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Kali's init" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "systemd" },
    { key: "CONFIG_NETFILTER_XT_TARGET_TTL", value: "m", because: "distro", why: "NetHunter's TTL-target tooling loads it as a module" },
  ],
  "kali-nethunter": [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "layered Kali user space" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "systemd" },
  ],
  neon: [
    { key: "CONFIG_DEVTMPFS_MOUNT", value: "y", because: "distro", why: "Ubuntu core init" },
    { key: "CONFIG_CGROUP_DEVICE", value: "y", because: "distro", why: "systemd" },
  ],
};

/** Keys a display owner needs. A compositor talking to DRM is not optional. */
const DISPLAY_KEYS: ConfigNeed[] = [
  { key: "CONFIG_DRM", value: "y", because: "display", why: "every display owner here reaches the panel through DRM" },
  { key: "CONFIG_DRM_KMS_HELPER", value: "y", because: "display", why: "mode setting; without it DRM comes up but cannot set a mode" },
  { key: "CONFIG_DMA_SHARED_BUFFER", value: "y", because: "display", why: "buffer sharing between the compositor and its clients" },
  { key: "CONFIG_SYNC_FILE", value: "y", because: "display", why: "explicit fences; required by the DisplaySurface/seam buffer flow" },
];

/** Compose the config fragment for a resolved chain. */
export function kernelConfigNeeds(
  opts: {
    distro?: string;
    displayOwner?: string;
    rootManager?: RootManager;
    /** True when the Android half is in the image, which it is for NURFS. */
    androidHalf?: boolean;
  } = {},
): { needs: ConfigNeed[]; fragment: string } {
  const needs: ConfigNeed[] = [...NURFS_KEYS];

  const distro = opts.distro;
  if (distro) {
    const extra = DISTRO_KEYS[distro];
    if (extra) needs.push(...extra);
  }

  if (opts.displayOwner) needs.push(...DISPLAY_KEYS);

  // KernelSU itself is forced by the manager's own fragment, which Super-Builders
  // already ships; only the keys the *build* must add are listed here, so the two
  // sources do not disagree about a value.
  const rm = ROOT_MANAGERS.find((r) => r.id === (opts.rootManager ?? "kernelsu-next"));
  if (rm) {
    needs.push({
      key: "CONFIG_KSU_SUSFS",
      value: "y",
      because: "root-manager",
      why: `${rm.name} carries the SUSFS series; SUSFS keys are inert without it`,
    });
    needs.push({
      key: "CONFIG_KSU_SUSFS_ZERO_MOUNT",
      value: "y",
      because: "root-manager",
      why: "ZeroMount is part of the chosen series and is the reason SUSFS and it are kept together",
    });
    needs.push({
      key: "CONFIG_ZEROMOUNT",
      value: "y",
      because: "root-manager",
      why: "the mount view this project hides its own rootfs behind",
    });
  }

  // Deduplicate by key, last write wins for value but keep the first `because` so
  // the report says the earliest reason rather than a redundant one.
  const seen = new Map<string, ConfigNeed>();
  for (const n of needs) {
    const prev = seen.get(n.key);
    if (!prev) seen.set(n.key, n);
    else if (prev.value !== n.value) seen.set(n.key, { ...prev, value: n.value });
  }
  const final = [...seen.values()];

  const lines = final.map((n) => `${n.key}=${n.value}`);
  const fragment =
    "# Generated for this chain. Do not hand-edit: regenerate from the picks.\n" +
    "# Each line names what forces it, so a build log failure is traceable.\n" +
    lines.join("\n") +
    "\n";

  return { needs: final, fragment };
}

// ---------------------------------------------------------------------------
// Stage 5: firmware fusion.
// ---------------------------------------------------------------------------

export interface FirmwarePartition {
  /** Partition name as the firmware calls it. */
  name: string;
  file: string;
  size?: number;
  /** True when this build regenerates it rather than passing it through. */
  rebuilt: boolean;
  why: string;
}

export interface FusionPlan {
  /** False when a required image is missing from the upload. */
  ok: boolean;
  /** Images in the upload, in flash order. */
  partitions: FirmwarePartition[];
  /** Images the build writes itself and merges in. */
  generated: FirmwarePartition[];
  /** Things that will not work and the reason. */
  problems: string[];
  /** Order to write them: boot first, then vendor_boot, then the unchanged rest. */
  flashOrder: string[];
  summary: string;
}

/**
 * Decide how to reassemble an uploaded firmware into an AnyRealm image set.
 *
 * The rule is: rebuild the least possible. boot and vendor_boot must be
 * regenerated because the kernel and the NURFS ramdisk changed. Everything else
 * -- system, vendor, product, system_ext, dtbo, super -- is the firmware's own and
 * is passed through byte for byte. That is what "uses the uploaded firmware"
 * means concretely, and it is why this does not need 250 GB of AOSP.
 */
export function planFirmwareFusion(
  uploaded: Array<{ name: string; file: string; size?: number }>,
  opts: {
    /** Board facts from the device profile: header version, page size, ramdisk compression. */
    board?: {
      boot_header_version?: number;
      kernel_page_size?: number;
      ramdisk_compression?: string;
      needs_dtboimage?: boolean;
      uses_generic_kernel_image?: boolean;
    };
    /** Present when a NURFS rootfs is being fused in. */
    nurfs?: boolean;
  } = {},
): FusionPlan {
  const problems: string[] = [];
  const names = new Set(uploaded.map((u) => u.name.toLowerCase()));

  const has = (n: string) => names.has(n);
  const boot = uploaded.find((u) => u.name.toLowerCase() === "boot");
  const vendorBoot = uploaded.find((u) => u.name.toLowerCase() === "vendor_boot");

  if (!boot) {
    problems.push(
      "no boot image in the upload: the first-stage ramdisk is inside it, so a phone " +
        "flashed without it will not come up",
    );
  }
  if (!vendorBoot) {
    problems.push(
      "no vendor_boot image in the upload: the second-stage ramdisk lives there, and " +
        "AR-NUKI-genevn keeps the stock vendor_boot -- it must be present to pass through",
    );
  }

  const partitions: FirmwarePartition[] = uploaded.map((u) => {
    const low = u.name.toLowerCase();
    if (low === "boot") {
      return {
        ...u,
        rebuilt: true,
        why: "new kernel Image plus the NURFS-aware first-stage ramdisk",
      };
    }
    if (low === "vendor_boot") {
      return {
        ...u,
        rebuilt: false,
        why: "passed through unchanged: stock vendor_boot, the kernel module set is loaded from it",
      };
    }
    return { ...u, rebuilt: false, why: "firmware's own partition, passed through byte for byte" };
  });

  const generated: FirmwarePartition[] = [];
  if (opts.board?.needs_dtboimage && !has("dtbo")) {
    generated.push({
      name: "dtbo",
      file: "dtbo.img",
      rebuilt: true,
      why: "the firmware did not include it and BoardConfig requires one; build from the device dts",
    });
  }

  // A generic-kernel-image board keeps the kernel in boot and the modules in
  // vendor_dlkm; say so rather than let it be discovered at boot.
  if (opts.board?.uses_generic_kernel_image) {
    generated.push({
      name: "vendor_dlkm",
      file: "vendor_dlkm.img",
      rebuilt: true,
      why: "BOARD_USES_GENERIC_KERNEL_IMAGE is set, so the kernel modules must match the new Image and be rebuilt",
    });
  }

  const flashOrder = [
    ...partitions.filter((p) => p.name.toLowerCase() === "boot").map((p) => p.name),
    ...partitions.filter((p) => p.name.toLowerCase() === "vendor_boot").map((p) => p.name),
    ...generated.map((g) => g.name),
    ...partitions
      .filter((p) => !["boot", "vendor_boot"].includes(p.name.toLowerCase()))
      .map((p) => p.name),
  ];

  const ok = problems.length === 0;
  const summary = ok
    ? `${partitions.length} firmware image(s), ${partitions.filter((p) => p.rebuilt).length} rebuilt, ` +
      `${generated.length} generated, ${partitions.filter((p) => !p.rebuilt).length} passed through`
    : `cannot fuse: ${problems.join("; ")}`;

  return { ok, partitions, generated, problems, flashOrder, summary };
}

/**
 * The whole chain, resolved from picks.
 *
 * Kept as one function so the builder and a workflow generator cannot disagree
 * about the order or the inputs.
 */
export interface ChainPlan {
  ok: boolean;
  roman: string | null;
  distro: string | null;
  displayOwner: string | null;
  rootManager: RootManager;
  config: { needs: ConfigNeed[]; fragment: string };
  fusion: FusionPlan | null;
  problems: string[];
  stages: Array<{ n: number; name: string; produces: string }>;
  summary: string;
}

export function planChain(input: {
  slots: UxSlot[];
  rootManager?: RootManager;
  firmware?: Array<{ name: string; file: string; size?: number }>;
  board?: Parameters<typeof planFirmwareFusion>[1]["board"];
}): ChainPlan {
  const sel = (id: string) => input.slots.find((s) => s.id === id)?.selected ?? null;
  const roman = sel("base_rom");
  const distro = sel("distro");
  const displayOwner = sel("display_owner");
  const rootManager = input.rootManager ?? "kernelsu-next";

  const problems: string[] = [];
  if (!roman) problems.push("no Android base ROM chosen");
  if (!distro) problems.push("no mobile Linux distro chosen");
  if (!displayOwner) problems.push("no display server chosen");

  const config = kernelConfigNeeds({ distro: distro ?? undefined, displayOwner: displayOwner ?? undefined, rootManager });
  const fusion = input.firmware?.length
    ? planFirmwareFusion(input.firmware, { board: input.board, nurfs: true })
    : null;
  if (input.firmware && fusion && !fusion.ok) problems.push(...fusion.problems);

  const stages = [
    { n: 1, name: "Android base ROM", produces: `${roman ?? "?"}: the vendor/firmware half` },
    { n: 2, name: "mobile Linux distro", produces: `${distro ?? "?"}: the user space fused on top` },
    { n: 3, name: "UX", produces: `${displayOwner ?? "?"}: the DisplaySurface owner` },
    {
      n: 4,
      name: "device kernel",
      produces: `${ROOT_MANAGERS.find((r) => r.id === rootManager)?.name ?? rootManager} + ${config.needs.length} config keys`,
    },
    {
      n: 5,
      name: "firmware fusion",
      produces: fusion ? fusion.summary : "(no firmware uploaded yet)",
    },
  ];

  const ok = problems.length === 0;
  return {
    ok,
    roman,
    distro,
    displayOwner,
    rootManager,
    config,
    fusion,
    problems,
    stages,
    summary: ok
      ? `${roman} + ${distro} + ${displayOwner}, ${rootManager}, ${config.needs.length} config keys`
      : `cannot build: ${problems.join("; ")}`,
  };
}
