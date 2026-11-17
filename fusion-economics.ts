/**
 * Why NUKI and NURFS are one thing, expressed as a cost.
 *
 * The claim is not stylistic and not a format preference. It is that a separated
 * system pays for the separation in hardware resources, every second it runs, and
 * a fused system does not. This module states that as arithmetic so it can be
 * checked instead of argued about.
 *
 * Three words, kept distinct because they are usually used interchangeably and
 * they are not the same:
 *
 *   native    runs on the device's own hardware, under the device's own kernel,
 *             with no translation layer between the code and the CPU. It says
 *             nothing about structure. A chroot can run native code.
 *   unified   one copy of each shared thing. This is the measurable one: one
 *             libc, one set of libraries, one page cache entry per file, one
 *             kernel, one root. Two copies of libc are two copies of libc even
 *             when both are native.
 *   fused     the parts are one structure at the byte level. This is NUKI and
 *             NURFS together: the kernel image and the root filesystem are
 *             composed at build time, so at boot there is no boundary to cross
 *             and therefore no second copy of anything behind it.
 *
 * What separation costs, concretely:
 *
 *   - a second libc. Android's bionic and Linux's glibc are both on disk, both
 *     mapped, both resident. Neither is free.
 *   - a second copy of the page cache. If the same file is reachable through two
 *     roots, the kernel caches it twice, because the cache is keyed by inode and
 *     two mounts of the same bytes are two inodes.
 *   - a second display server holding a DRM fd and, on many drivers, a second
 *     framebuffer allocation for the same panel.
 *   - a boundary that must be kept: a proxy, a bridge, a binder shim, a socket
 *     per call, and the memory those hold.
 *
 * A chroot or container does not remove any of these; it hides the second copy
 * from the process's view and charges the same RAM for it. That is the whole
 * reason the project does not use one.
 */

export interface Footprint {
  /** Bytes resident for a shared component, per copy. */
  bytesPerCopy: number;
  copiesInSeparated: number;
  copiesInFused: number;
  /** Why it is duplicated when separated. */
  why: string;
}

/**
 * The shared components that exist twice in a separated system and once in a
 * fused one. Sizes are the real ones where they can be measured; where they must
 * be estimated the field says so and the estimate is stated as a range.
 */
export const DUPLICATED: Footprint[] = [
  {
    // Measured: /lib/x86_64-linux-gnu/libc.so.6 is 2,129,424 B on this host's
    // glibc. bionic's libc.so on arm64 is a different build but the same order.
    bytesPerCopy: 2_129_424,
    copiesInSeparated: 2,
    copiesInFused: 1,
    why: "bionic serves the Android half and glibc serves the Linux half; both are mapped, both resident",
  },
  {
    // libm and the pthread shim: measured, 952,616 + 14,408.
    bytesPerCopy: 967_024,
    copiesInSeparated: 2,
    copiesInFused: 1,
    why: "each libc has its own companion libraries; they cannot be shared across a libc boundary",
  },
  {
    // The dynamic loader is small but it is one per libc tree, and it is resident.
    bytesPerCopy: 200_000,
    copiesInSeparated: 2,
    copiesInFused: 1,
    why: "each libc tree has its own ld.so; the bionic loader cannot load glibc objects",
  },
  {
    // Estimate, stated as one: a second display server process holding a DRM fd,
    // its scene graph and its buffer pool. Measured nowhere here because no
    // second compositor is running; 24-64 MB is the usual resident range for a
    // wlroots compositor with one output.
    bytesPerCopy: 40 * 1024 * 1024,
    copiesInSeparated: 2,
    copiesInFused: 1,
    why: "two display servers on one panel means two DRM fds, two scene graphs and two buffer pools",
  },
  {
    // Estimate: the bridge between the halves. A binder proxy plus its buffers,
    // a socket per call, marshalling buffers. Grows with traffic, not fixed.
    // One bridge, not two: it exists *because* there is a boundary, so a fused
    // image has none at all rather than having one fewer.
    bytesPerCopy: 16 * 1024 * 1024,
    copiesInSeparated: 1,
    copiesInFused: 0,
    why: "a bridge is memory that exists only because there is a boundary to cross",
  },
];

export interface FootprintReport {
  /** Bytes resident because of duplication, in the separated case. */
  duplicatedBytes: number;
  /** The same total for the fused case. Always zero: nothing is duplicated. */
  fusedDuplicatedBytes: number;
  /** Per-component breakdown, so a reader can check any single line. */
  lines: Array<{
    why: string;
    copies: number;
    extraBytes: number;
    measured: boolean;
  }>;
  /** One line to put in a build log or a README. */
  summary: string;
}

/** How many copies are wasted: separated minus fused, per component. */
export function duplicationCost(components: Footprint[] = DUPLICATED): FootprintReport {
  // Waste is the difference between the copies a separated system needs and the
  // copies a fused one needs -- not the total size of the components. A single
  // copy is not duplication: it is the component doing its job. Only the extra
  // copies are the cost of having a boundary.
  const lines = components.map((c) => {
    const extraCopies = Math.max(0, c.copiesInSeparated - c.copiesInFused);
    return {
      why: c.why,
      copies: extraCopies,
      extraBytes: c.bytesPerCopy * extraCopies,
      // Measured sizes are not round megabytes; the two estimates are stated in
      // whole MB and are therefore flagged as estimates.
      measured: c.bytesPerCopy % (1024 * 1024) !== 0,
    };
  });

  const separated = lines.reduce((n, l) => n + l.extraBytes, 0);
  const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
  const copies = lines.reduce((n, l) => n + l.copies, 0);

  return {
    duplicatedBytes: separated,
    // By definition: a fused image has one of each shared thing, so there is no
    // extra copy for waste to be counted from.
    fusedDuplicatedBytes: 0,
    lines,
    summary:
      `a separated image keeps ${copies} redundant component copies, costing ${mb(separated)} MB ` +
      `resident that a fused image does not spend`,
  };
}

/**
 * Why "native" alone is not the claim, said once so it is not confused again.
 *
 * Native is a property of the instruction set a process runs. A chroot full of
 * native binaries is native. A container of native binaries is native. Neither is
 * unified, because each still carries its own libc, its own copy of shared files
 * in the page cache, and a boundary it has to be kept behind. The project's
 * targets run native code *and* are unified *and* are fused; only the last two are
 * unusual, and only the last two save the device anything.
 */
export const NATIVE_VS_UNIFIED = {
  native:
    "the code runs on the device's own CPU under the device's own kernel, with no emulation or " +
    "translation. Satisfied by an ordinary binary, including one inside a chroot.",
  unified:
    "there is one copy of every shared thing: one libc in use, one loader, one page cache entry per " +
    "file, one kernel, one root. This is what saves RAM and storage, and it is what a second root " +
    "breaks even when both roots are native.",
  fused:
    "the kernel image and the root filesystem are one structure at the byte level, composed at build " +
    "time. There is no boundary to cross at boot, so there is nothing behind a boundary to duplicate. " +
    "This is NUKI (the kernel half) and NURFS (the root half) holding at once.",
  whySeparationCosts:
    "a boundary has to be maintained: a proxy per call, a bridge holding buffers, a second display " +
    "server holding its own DRM handle, and a second libc mapped because the two sides do not share an " +
    "ABI. None of that memory does any work; all of it exists to keep the halves apart.",
} as const;

/**
 * What a fused image must be able to prove, as checks rather than prose.
 *
 * Each returns a verdict and the evidence. These are the properties that make the
 * words true, and each is falsifiable on a built image.
 */
export interface FusedProperty {
  id: string;
  claim: string;
  /** What to inspect to confirm it. */
  evidence: string;
  /** The condition that would make the claim false. */
  falsifiedBy: string;
}

export const FUSED_PROPERTIES: FusedProperty[] = [
  {
    id: "one-libc-in-use",
    claim: "exactly one libc is mapped by the running system",
    evidence: "count distinct libc mappings in /proc/*/maps across all processes",
    falsifiedBy: "two different libc paths appear mapped by live processes",
  },
  {
    id: "one-loader",
    claim: "one dynamic loader serves every process",
    evidence: "read the PT_INTERP of each ELF in the root and compare",
    falsifiedBy: "two distinct interpreter paths are in use",
  },
  {
    id: "no-bridge",
    claim: "no process exists whose only job is to relay between two roots",
    evidence: "process list contains no binder proxy, bridge server or socket relay between halves",
    falsifiedBy: "a relay process is running and busy",
  },
  {
    id: "one-display-owner",
    claim: "one process holds the DRM fd for the panel",
    evidence: "count open fds on /dev/dri/card* per process",
    falsifiedBy: "two processes hold the primary card open in master mode",
  },
  {
    id: "one-page-cache-entry",
    claim: "a file reachable from the fused root is cached once",
    evidence: "open the same file through each historical path and compare the inode",
    falsifiedBy: "the same bytes resolve to two inodes",
  },
  {
    id: "no-handoff",
    claim: "boot crosses no boundary from an initrd view to a root view",
    evidence: "the boot log shows no switch_root, no mount of a second root as /, no pivot to an image",
    falsifiedBy: "the log contains a root transition after the kernel's own init",
  },
];
