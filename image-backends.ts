/**
 * Image backends: debos and mkosi, and what they are allowed to do for NUKI.
 *
 * NUKI is the project's structure, not a format borrowed from either tool. That
 * distinction has to be kept straight, because one of these tools ships a format
 * with a nearly identical name doing the opposite thing:
 *
 *   mkosi `Format=uki` produces a Unified Kernel Image: one PE binary with the
 *   kernel, initrd and cmdline concatenated. The firmware boots it, the kernel
 *   then unpacks the initrd and *hands off* to whatever is inside. That handoff
 *   is the opposite of a fusion. It is a well-made handoff, but it is still two
 *   stages with a boundary, and the boundary is where the initrd's view of the
 *   world ends and the real root's begins.
 *
 *   NUKI has no handoff. The kernel and the root filesystem are composed into one
 *   structure at build time, so at boot there is no transition from an initrd view
 *   to a root view -- the root is already the root. That is why the project does
 *   not accept `Format=uki` as a way to produce NUKI, and why the builder refuses
 *   it when the structure is set to NUKI. Using mkosi to emit a UKI and calling it
 *   NUKI would be exactly the substitution this project exists to avoid.
 *
 * So the two tools are used for what each is genuinely good at, and neither is
 * allowed to define NUKI:
 *
 *   debos  builds the root filesystem and the partition table, from a YAML recipe
 *          of independent, inspectable actions. This is the NURFS half.
 *   mkosi  builds the OS tree and, on the desktop edition, the ESP and boot
 *          artefacts. This is the boot half. It is told `Format=disk` or
 *          `Format=directory`, never `uki`, when NUKI is the structure.
 *
 * Both are driven the way their own front ends drive them, from forks that are
 * pinned so a recipe change cannot arrive unannounced.
 */

export type Backend = "debos" | "mkosi";

export interface BackendRepo {
  id: Backend;
  name: string;
  repo: string;
  branch: string;
  /** What this tool is responsible for, and therefore what it may not touch. */
  owns: string;
  note: string;
}

/**
 * The two forks, as verified with `git ls-remote`. `debos` had to be found under
 * its real name: `015stray91/debos` does not exist, `015stray91/debos-realm` does.
 */
export const BACKENDS: BackendRepo[] = [
  {
    id: "debos",
    name: "Debian OS image builder (debos)",
    repo: "https://github.com/015stray91/debos-realm",
    branch: "main",
    owns: "the NURFS root filesystem and the partition table",
    note:
      "A recipe is a YAML list of independent actions: debootstrap or mmdebstrap, apt, overlay, " +
      "filesystem-deploy, image-partition, raw, pack. `image-partition` takes an explicit partition " +
      "list (name, partlabel, fslabel, start, end, fs, flags, features) and mountpoints, so the " +
      "layout is data rather than a script -- which is why the desktop ISO does not have to assume a " +
      "partition table. Invoked as `debos -t KEY:VALUE recipe.yaml` with `--artifactdir`; runs inside " +
      "fakemachine so the build does not need root on the host.",
  },
  {
    id: "mkosi",
    name: "mkosi",
    repo: "https://github.com/015stray91/mkosi",
    branch: "main",
    owns: "the OS tree and the boot artefacts (ESP, bootloader entries)",
    note:
      "Configured by `mkosi.conf` sections: [Distribution] (fedora, debian, kali, ubuntu, arch, " +
      "opensuse, custom...), [Output] (directory, tar, cpio, disk, esp, uki, oci...), [Content] " +
      "(Packages, Bootable), [Build], [Runtime]. It also supports `UnifiedKernelImages=` and a " +
      "`Format=uki` that concatenates kernel+initrd into one PE binary. That is a UKI, and a UKI is a " +
      "handoff, not a fusion: the kernel still unpacks an initrd and transitions to a root. NUKI is " +
      "not that, so this builder never emits `Format=uki` on a NUKI build.",
  },
];

/** The structure a build targets. NUKI is the project's own; the others are what the tools emit. */
export type Structure = "nuki" | "uki" | "partitioned";

export interface StructureRefusal {
  requested: string;
  reason: string;
  /** What to use instead, in this project's terms. */
  instead: string;
}

/**
 * Refuse a structure that is not NUKI when NUKI was asked for.
 *
 * Kept as a function rather than a comment because this is the single point where
 * a plausible-looking shortcut (emit a UKI, call it NUKI) gets caught. A comment
 * does not stop a workflow.
 */
export function refuseUkiAsNuki(
  structure: Structure,
  backend: Backend,
  format?: string,
): StructureRefusal | null {
  if (structure !== "nuki") return null;

  const f = (format ?? "").toLowerCase();
  if (backend === "mkosi" && (f === "uki" || f === "esp")) {
    return {
      requested: `mkosi Format=${format}`,
      reason:
        `Format=${format} produces a ${f === "uki" ? "Unified Kernel Image" : "bootable ESP with a UKI"}: ` +
        `the kernel unpacks an initrd and hands off to the root inside it. NUKI is a complete fusion ` +
        `with no handoff, so a UKI is a different structure that happens to have a similar name.`,
      instead:
        "Use Format=disk or Format=directory from mkosi for the boot/OS tree, and let debos build the " +
        "NURFS rootfs and partition layout. The fusion is the project's own step, not a tool's output format.",
    };
  }

  if (backend === "mkosi" && f === "") {
    // An unset Format= on a NUKI build defaults to `disk` in practice, which is
    // acceptable; nothing to refuse. Returned explicitly so the empty case is a
    // decision rather than an oversight.
    return null;
  }

  return null;
}

export interface BackendInvocation {
  backend: Backend;
  /** The command, as an argv array so it is not re-parsed by a shell. */
  argv: string[];
  cwd: string;
  /** Files this invocation expects to exist, so a missing one fails before the build. */
  expects: string[];
  /** Artefacts it writes, which the next stage consumes. */
  produces: string[];
  /** Things this invocation deliberately does not do. */
  doesNot: string[];
}

/**
 * Build the debos invocation for the NURFS half.
 *
 * `vars` go through `-t KEY:VALUE`, which is debos's own templating path, so the
 * recipe stays generic and the choice lives in the builder.
 */
export function debosInvocation(opts: {
  recipe: string;
  artifactdir: string;
  vars?: Record<string, string>;
  scratch?: string;
  cpus?: number;
  memory?: string;
  dryRun?: boolean;
}): BackendInvocation {
  const argv = ["debos"];
  if (opts.scratch) argv.push(`--scratchsize=${opts.scratch}`);
  if (opts.cpus) argv.push(`--cpus=${opts.cpus}`);
  if (opts.memory) argv.push(`--memory=${opts.memory}`);
  if (opts.dryRun) argv.push("--dry-run");
  argv.push(`--artifactdir=${opts.artifactdir}`);
  for (const [k, v] of Object.entries(opts.vars ?? {})) argv.push("-t", `${k}:${v}`);
  argv.push(opts.recipe);

  return {
    backend: "debos",
    argv,
    cwd: opts.artifactdir,
    expects: [opts.recipe],
    produces: [
      "rootfs tarball or directory for the chosen distro",
      "disk image with the partition layout declared in the recipe",
    ],
    doesNot: [
      "decide the display server: that is the UX slot",
      "patch or build the kernel: that is the device-kernel stage",
      "emit a UKI: debos has no such action, which is the point",
    ],
  };
}

/** Build the mkosi invocation for the OS-tree / boot half. */
export function mkosiInvocation(opts: {
  cwd: string;
  verb: "build" | "summary" | "init" | "cat-config";
  distribution?: string;
  release?: string;
  format?: "disk" | "directory" | "esp" | "tar";
  bootable?: boolean;
  imageId?: string;
  packages?: string[];
  structure?: Structure;
}): BackendInvocation & { refusal?: StructureRefusal } {
  const structure = opts.structure ?? "nuki";
  const refusal = refuseUkiAsNuki(structure, "mkosi", opts.format);

  const argv = ["mkosi"];
  if (opts.distribution) argv.push(`--distribution=${opts.distribution}`);
  if (opts.release) argv.push(`--release=${opts.release}`);
  if (opts.format) argv.push(`--format=${opts.format}`);
  if (opts.bootable !== undefined) argv.push(`--bootable=${opts.bootable ? "yes" : "no"}`);
  if (opts.imageId) argv.push(`--image-id=${opts.imageId}`);
  for (const p of opts.packages ?? []) argv.push(`--package=${p}`);
  argv.push(opts.verb);

  return {
    backend: "mkosi",
    argv,
    cwd: opts.cwd,
    expects: [`${opts.cwd}/mkosi.conf`],
    produces: [
      opts.format === "disk" ? "GPT disk image (systemd-repart)" : "OS tree",
      ...(opts.bootable ? ["bootloader entries or ESP payload"] : []),
    ],
    doesNot: [
      "produce the fused structure: NUKI is composed by the project, not by a mkosi format",
      ...(structure === "nuki" ? ["emit Format=uki: that is a handoff, not a fusion"] : []),
    ],
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * Which backend does which part, so the workflow generator never asks one tool to
 * do the other's job.
 */
export function backendSplit(structure: Structure): {
  structure: Structure;
  nurfs: Backend;
  boot: Backend;
  fusion: "anyrealm" | "tool";
  note: string;
} {
  if (structure === "nuki") {
    return {
      structure,
      nurfs: "debos",
      boot: "mkosi",
      fusion: "anyrealm",
      note:
        "Neither tool performs the fusion. debos produces the rootfs and layout, mkosi produces the OS " +
        "tree and boot artefacts, and the project's own stage composes them into one structure with no " +
        "handoff. This is the only split where the result is NUKI.",
    };
  }
  if (structure === "uki") {
    return {
      structure,
      nurfs: "debos",
      boot: "mkosi",
      fusion: "tool",
      note:
        "mkosi Format=uki fuses kernel and initrd into one binary; the kernel still hands off to an " +
        "initrd root at boot. Valid as its own structure, and not NUKI.",
    };
  }
  return {
    structure,
    nurfs: "debos",
    boot: "mkosi",
    fusion: "tool",
    note:
      "Both tools can emit a conventionally partitioned image; there is no fusion step at all and the " +
      "rootfs is a normal root. This is the honest fallback for a device that has no fused target.",
  };
}
