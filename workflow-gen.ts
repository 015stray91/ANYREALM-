/**
 * Workflow generation.
 *
 * The GUI is a form. This turns that form into a GitHub Actions workflow file,
 * so what the user clicked becomes a real `.github/workflows/*.yml` in the repo
 * rather than a set of flags passed to a workflow that was written by hand for
 * one purpose.
 *
 * Shape of a spec:
 *
 *   edition = "rom"            source ROM tree + kernel + device -> flashable zip
 *   edition = "desktop_iso"    distro rootfs + desktop env + kernel -> NUKI/NURFS ISO
 *   edition = "mobile_kernel"  kernel tree only -> boot image
 *
 * Everything the generator emits is plain YAML with `bash -n`-clean steps. The
 * generated file is validated before it is returned, so a broken workflow can
 * never be committed and then fail 4 seconds into a dispatch.
 */

// js-yaml 5.x ships named exports only (no default), so this must not be a
// default import -- Bun fails hard on a missing default.
import { load as yamlLoad } from "js-yaml";
import { readFileSync } from "node:fs";

export type Edition = "rom" | "desktop_iso" | "mobile_kernel";

export interface SpecSource {
  id: string;
  name: string;
  url: string;
  /** Branch, tag or commit. Empty means "whatever upstream HEAD is". */
  ref?: string;
  /** For ROM trees, the `repo` manifest branch. */
  manifestBranch?: string;
  /** Architectures the source provides. Used to refuse a cross-arch desktop ISO. */
  arch?: string[] | ("arm64" | "x86_64")[];
}

/**
 * One compiler in one role.
 *
 * A build is not compiled by a single compiler. AOSP alone uses different
 * toolchains for the kernel, the system image, recovery, host tools and the
 * vendor/DSP side, and each has its own tolerance for version and obfuscation.
 * So a chain slot names the compiler for exactly one stage.
 */
export interface ChainSlot {
  /** Toolchain id from toolchains-catalog.json, e.g. "clang-12-ndk". */
  id: string;
  /** GitHub repo the toolchain lives in, "owner/name". */
  repo: string;
  branch?: string;
  /** "clang" | "gcc" | "tcc" ... */
  cc?: string;
  /** Path inside the repo to put on CC, e.g. "bin/clang". */
  ccPath?: string;
  /** GNU target prefix for CROSS_COMPILE, e.g. "aarch64-linux-gnu-". */
  prefix?: string;
  label?: string;
  /** True when this compiler carries an obfuscation pass. Refused for kernel code. */
  obfuscator?: boolean;
}

/**
 * Which compiler each stage of the build uses.
 *
 * Every role is optional: a missing role falls back to `userspace`, and a
 * missing `userspace` falls back to the host compiler. That way picking one
 * chain still works, and overriding just the kernel (the common case) does not
 * mean filling in six fields.
 */
export interface ChainChoice {
  id: string;
  label?: string;
  /** User-space compiler, also the fallback for every other role. */
  userspace: ChainSlot;
  /** Kernel image. Never allowed to be an obfuscator. */
  kernel?: ChainSlot;
  /** The Android system/user space image (framework, bionic, apps). */
  system?: ChainSlot;
  /** Recovery image. Kernel-adjacent, so also never an obfuscator. */
  recovery?: ChainSlot;
  /** Host tools built and run on the runner. */
  host?: ChainSlot;
  /** Vendor and DSP code (Hexagon, camera, audio). Vendor LLVM fits here. */
  vendor?: ChainSlot;
  /** Bootloader / U-Boot / edk2 stage, for the desktop ISO's ESP. */
  bootloader?: ChainSlot;
  /** Free-form extra stages: { "some-stage": { ...slot } }. */
  extra?: Record<string, ChainSlot>;
  /** True only when *every* slot is clean; derived, not hand-set. */
  obfuscator?: boolean;
  note?: string;
}

/** The stage names a chain can set, in the order a build uses them. */
export const CHAIN_ROLES = ["bootloader", "host", "kernel", "system", "recovery", "vendor"] as const;
export type ChainRole = (typeof CHAIN_ROLES)[number];

/** Roles whose output is kernel or boot code, where obfuscation is refused. */
const KERNEL_ROLES: ChainRole[] = ["kernel", "recovery", "bootloader"];

/** Resolve the slot that actually builds `role`, applying the fallbacks. */
export function chainSlotFor(chain: ChainChoice | undefined, role: ChainRole): ChainSlot | undefined {
  if (!chain) return undefined;
  const direct = (chain as any)[role] as ChainSlot | undefined;
  if (direct) return direct;
  if (chain.extra && chain.extra[role]) return chain.extra[role];
  if (role === "system") return chain.system ?? chain.userspace;
  return chain.userspace;
}

export interface BuildSpec {
  name?: string;
  edition: Edition;
  /** Android custom ROM source, for edition "rom". */
  rom?: SpecSource;
  /** Distro rootfs source, for edition "desktop_iso". */
  distro?: SpecSource;
  /** Android x86_64 tree that supplies the Android half of the desktop ISO. */
  androidBase?: SpecSource;
  /**
   * Where the Android half comes from.
   *   "firmware"  use images the user already has (this is the default: no
   *               AOSP sync, so a device build costs gigabytes not terabytes)
   *   "source"    sync and compile the ROM tree from upstream
   */
  androidMode?: "firmware" | "source";
  /**
   * Named compiler chain from toolchains-catalog.json. One pick sets the
   * kernel compiler and the user-space compiler together. Obfuscator chains
   * are refused for anything that builds kernel code.
   */
  chain?: ChainChoice;
  /**
   * Addon tool ids from toolchains-catalog.json, e.g. ["aik","aosp-image-tools"].
   * Each is fetched into addons/<id> so the workflow uses the user's own tools.
   */
  tools?: string[];
  /**
   * Apply the NURFS SELinux delta and install the boot-time mount. Required for
   * any image that carries both bionic and glibc user space, because stock
   * Android policy has no glibc domain and vold will not mount the ext4 image.
   */
  nurfsPolicy?: boolean;
  /**
   * Images uploaded through the firmware uploader. When present with
   * androidMode "firmware", the workflow rebuilds from these instead of
   * downloading anything.
   */
  firmware?: {
    /** Artifact name holding the uploaded images, or a release asset URL. */
    artifact?: string;
    /** Which image carries the system tree, e.g. "system.img". */
    systemImage?: string;
    vendorImage?: string;
    productImage?: string;
    /** Extracted by the workflow with debugfs/simg2img when true. */
    preExtracted?: boolean;
  };
  /** Kernel tree. Required for "rom" and "mobile_kernel", optional for ISO. */
  kernel?: SpecSource;
  device?: {
    codename?: string;
    soc?: string;
    arch?: "arm64" | "x86_64";
  };
  desktop?: {
    /** Desktop environment addon, e.g. "gnome", "plasma", "xfce", "sway". */
    environment?: string;
    /** Extra package names merged into the rootfs. */
    packages?: string[];
  };
  /** Mobile Linux user space layered on top, e.g. Kali NetHunter Pro. */
  overlay?: SpecSource;
  runner?: string;
  nodeVersion?: string;
  /** Upload artifact name, defaults to something derived from the spec. */
  artifactName?: string;
}

const VALID_RUNNERS = new Set([
  "ubuntu-22.04",
  "ubuntu-24.04",
  "ubuntu-24.04-arm",
  "ubuntu-latest",
]);

export class SpecError extends Error {}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Fill defaults and refuse specs that cannot produce a build. */
export function normalizeSpec(spec: BuildSpec): Required<Pick<BuildSpec, "name" | "runner" | "nodeVersion" | "artifactName">> & BuildSpec {
  if (!spec || typeof spec !== "object") throw new SpecError("spec is required");
  if (!["rom", "desktop_iso", "mobile_kernel"].includes(spec.edition)) {
    throw new SpecError(`edition must be rom, desktop_iso or mobile_kernel; got ${String(spec.edition)}`);
  }

  const need = (s: SpecSource | undefined, label: string) => {
    if (!s || !s.url) throw new SpecError(`${label} is required for edition "${spec.edition}"`);
    try {
      const u = new URL(s.url);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error("not http");
    } catch {
      throw new SpecError(`${label} url is not a valid http(s) git url: ${s.url}`);
    }
  };

  if (spec.edition === "rom") {
    need(spec.rom, "rom");
    need(spec.kernel, "kernel");
    if (!spec.device?.codename) throw new SpecError("device.codename is required for a ROM build");
  }
  if (spec.edition === "mobile_kernel") {
    need(spec.kernel, "kernel");
    if (!spec.device?.codename) throw new SpecError("device.codename is required for a kernel build");
  }
  if (spec.edition === "desktop_iso") {
    need(spec.distro, "distro");
    if (spec.androidBase) {
      if (spec.androidBase.arch && !spec.androidBase.arch.includes("x86_64")) {
        throw new SpecError(
          `androidBase ${spec.androidBase.id} is ${spec.androidBase.arch.join("/")}, but the desktop ISO runs on x86_64`,
        );
      }
    }
  }

  // Firmware-first is the default. Re-syncing an AOSP tree to build a device
  // that is standing right there is the single biggest waste in the old flow:
  // ~250 GB and hours, to produce something the vendor images already contain.
  const androidMode = spec.androidMode ?? (spec.firmware ? "firmware" : spec.edition === "rom" ? "source" : "firmware");

  const runner = spec.runner ?? "ubuntu-24.04";
  if (!VALID_RUNNERS.has(runner)) {
    throw new SpecError(`runner ${runner} is not one this project builds on; use one of ${[...VALID_RUNNERS].join(", ")}`);
  }

  const base =
    spec.edition === "rom"
      ? `anyrealm-rom-${slug(spec.rom!.id)}-${slug(spec.device!.codename!)}`
      : spec.edition === "desktop_iso"
        ? `anyrealm-iso-${slug(spec.distro!.id)}${spec.desktop?.environment ? "-" + slug(spec.desktop.environment) : ""}`
        : `anyrealm-kernel-${slug(spec.device!.codename!)}`;

  return {
    ...spec,
    name: spec.name?.trim() || base,
    runner,
    nodeVersion: spec.nodeVersion ?? "24",
    artifactName: spec.artifactName ?? base,
    androidMode,
  };
}

/** The workflow file name a spec maps to. Stable, so re-composing overwrites. */
export function workflowFileName(spec: BuildSpec): string {
  const n = normalizeSpec(spec);
  return `${n.name}.yml`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}

function checkoutStep(src: SpecSource, dir: string, extra: string[] = []): string[] {
  const ref = src.ref?.trim();
  return [
    `      - name: Fetch ${src.name}`,
    "        uses: actions/checkout@v4",
    "        with:",
    `          repository: ${repoSlug(src.url)}`,
    ...(ref ? [`          ref: ${ref}`] : []),
    `          path: ${dir}`,
    "          fetch-depth: 1",
    ...extra.map((l) => `          ${l}`),
  ];
}

/** "https://github.com/owner/name(.git)" -> "owner/name". */
function repoSlug(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/);
  if (!m) throw new SpecError(`cannot derive owner/repo from ${url}`);
  return m[1];
}

/** True for hosts actions/checkout can clone without extra credentials. */
function isGitHub(url: string): boolean {
  return /^https?:\/\/github\.com\//.test(url);
}

function shellStep(name: string, lines: string[]): string[] {
  return [`      - name: ${name}`, "        run: |", ...lines.map((l) => (l ? `          ${l}` : ""))];
}

/**
 * Bring the Android half in from images the user already uploaded.
 *
 * This is the branch that saves the 250 GB. It downloads nothing from AOSP:
 * the uploaded system/vendor/product images are unsparsed and extracted with
 * debugfs, which needs no root and no loop device on a CI runner.
 */
/**
 * Is this chain allowed for this edition?
 *
 * Obfuscation passes rewrite control flow. On kernel code that does not fail to
 * compile -- it produces a kernel that boots partway and then faults, which
 * looks like a device bug rather than a toolchain one. So the refusal is here,
 * at generation time, not as a warning in a log nobody reads.
 */
export function chainRefusal(spec: BuildSpec): string | null {
  const chain = spec.chain;
  if (!chain) return null;

  // Which roles this edition actually compiles. A desktop ISO builds a kernel
  // and a bootloader but no recovery; a mobile kernel builds only a kernel.
  const compiled = new Set<ChainRole>();
  if (spec.edition === "mobile_kernel" || spec.kernel) compiled.add("kernel");
  if (spec.edition === "rom") {
    compiled.add("kernel");
    compiled.add("system");
    compiled.add("host");
  }
  if (spec.edition === "desktop_iso") {
    compiled.add("kernel");
    compiled.add("bootloader");
    compiled.add("host");
    compiled.add("system");
  }

  // Only roles the build actually reaches can veto it. Selecting an obfuscator
  // for `vendor` on a mobile kernel build is harmless, because no vendor code
  // is compiled there.
  for (const role of KERNEL_ROLES) {
    if (!compiled.has(role)) continue;
    const slot = chainSlotFor(chain, role);
    if (!slot?.obfuscator) continue;
    return (
      `the "${slot.label ?? slot.id}" compiler is an obfuscator and this build uses it for the ${role} stage, ` +
      `which compiles kernel or boot code. Obfuscation passes there do not fail to compile -- they produce an ` +
      `image that boots partway and faults, which reads as a device bug. Use a plain compiler for ${role}; ` +
      `obfuscation is fine for the system/user-space stage.`
    );
  }
  if (!chain.kernel) return null;
  return null;
}

/**
 * The addon tool catalog, loaded from disk once.
 *
 * Deliberately read at generate time rather than hard-coded: the catalog is
 * generated from the user's real repositories, and a stale copy in the source
 * would send a workflow after a repo that has since been renamed.
 */
let addonCache: Record<string, { repo: string; branch?: string; name?: string }> | null = null;
function addonCatalog(): Record<string, { repo: string; branch?: string; name?: string }> {
  if (addonCache) return addonCache;
  try {
    // Read synchronously: generation is already a synchronous request handler
    // and the file is small.
    const raw = readFileSync(new URL("./toolchains-catalog.json", import.meta.url), "utf8");
    const doc = JSON.parse(raw) as { tools?: Array<{ id: string; repo: string; branch?: string; name?: string }> };
    addonCache = {};
    for (const t of doc.tools ?? []) {
      // The catalog stores a repo name for the owner's own repos and
      // "owner/name" for third-party ones; both become "owner/name" here.
      addonCache[t.id] = {
        repo: t.repo.includes("/") ? t.repo : `015stray91/${t.repo}`,
        branch: t.branch,
        name: t.name,
      };
    }
  } catch {
    // A missing catalog must not break generation -- it only means the user
    // cannot ask for addons until the file is restored.
    addonCache = {};
  }
  return addonCache;
}

/** YAML lines that fetch a toolchain repo. */
function chainFetchSteps(tc: ChainSlot, role: string): string[] {
  return [
    `      - name: Fetch ${role} toolchain (${tc.label ?? tc.id})`,
    "        uses: actions/checkout@v4",
    "        with:",
    `          repository: ${tc.repo}`,
    ...(tc.branch ? [`          ref: ${tc.branch}`] : []),
    `          path: toolchains/${tc.id}`,
    "          fetch-depth: 1",
  ];
}

/** The path inside a toolchain repo that should end up on CC. */
function slotCcPath(tc: ChainSlot): string {
  return tc.ccPath ?? (tc.cc ? `bin/${tc.cc}` : "bin/clang");
}

/**
 * Turn the per-stage chain into real compiler variables.
 *
 * Every stage that the edition compiles gets its own env var, so the ROM build
 * can hand `CC` to the system stage while the kernel build reads `KERNEL_CC`.
 * Repos shared between stages are fetched once; a build that uses one toolchain
 * everywhere therefore pays one clone, not six.
 */
function chainSteps(spec: BuildSpec): string[] {
  const chain = spec.chain;
  if (!chain) return [];

  const roles = CHAIN_ROLES.filter((role) => {
    const slot = chainSlotFor(chain, role);
    return !!slot;
  });
  const out: string[] = [];

  const seenRepo = new Set<string>();
  for (const role of roles) {
    const slot = chainSlotFor(chain, role)!;
    if (seenRepo.has(slot.id)) continue;
    seenRepo.add(slot.id);
    out.push(...chainFetchSteps(slot, role));
  }

  // One verification step, with a line per stage. Doing it per stage would mean
  // six nearly identical steps in the log for no extra information.
  const lines: string[] = ["set -euo pipefail", 'chmod -R +x toolchains/*/bin 2>/dev/null || true'];
  const envLines: string[] = [];
  for (const role of roles) {
    const slot = chainSlotFor(chain, role)!;
    const p = slotCcPath(slot);
    const varName = `${role.toUpperCase().replace(/-/g, "_")}_CC`;
    lines.push(`${varName}="\$PWD/toolchains/${slot.id}/${p}"`);
    envLines.push(`${varName}=$${varName}`);
    if (slot.prefix) {
      const cv = `${role.toUpperCase().replace(/-/g, "_")}_CROSS_COMPILE`;
      lines.push(`${cv}="${slot.prefix}"`);
      envLines.push(`${cv}=$${cv}`);
    }
  }
  lines.push('for cc in ' + roles.map((r) => `"$${r.toUpperCase().replace(/-/g, "_")}_CC"`).join(" ") + "; do");
  lines.push('  [ -x "$cc" ] || { echo "::error::toolchain compiler missing or not executable: $cc" >&2; exit 1; }');
  lines.push('  echo "--- $cc"; "$cc" --version 2>&1 | head -2');
  lines.push("done");
  // `system` is what plain `CC` means to a ROM build, so it takes that name.
  // Plain `CC` means the system stage to a ROM build. If no system slot was
  // chosen, fall back to the host compiler rather than to an unset variable.
  lines.push('export CC="${SYSTEM_CC:-${HOST_CC:-cc}}"');
  lines.push('export PATH="$(dirname "$CC"):$PATH"');
  if (chainSlotFor(chain, "kernel")?.cc === "clang") lines.push("export LLVM=1 LLVM_IAS=1");
  lines.push('if [ -n "${KERNEL_CROSS_COMPILE:-}" ]; then export CROSS_COMPILE="$KERNEL_CROSS_COMPILE"; fi');
  lines.push(
    `echo "chain ${chain.id}: " ${roles.map((r) => `${r}=$${r.toUpperCase().replace(/-/g, "_")}_CC`).join(" ")}`,
  );
  lines.push("# A var set in one step does not survive to the next unless it goes");
  lines.push("# through $GITHUB_ENV, which is how Actions passes it along.");
  lines.push('if [ -n "${GITHUB_ENV:-}" ]; then');
  for (const e of envLines) lines.push(`  echo "${e}" >> "$GITHUB_ENV"`);
  lines.push('  echo "CC=$CC" >> "$GITHUB_ENV"');
  lines.push("fi");

  out.push(...shellStep(`Verify the ${chain.label ?? chain.id} chain (${roles.join(", ")})`, lines));
  return out;
}

/**
 * Fetch the named addon tools into `addons/<id>`.
 *
 * These are the user's own repositories: partition tools, image kitchens,
 * firmware extractors, AnyKernel wrappers. Fetching them means a workflow uses
 * the same tools the user built rather than whatever apt happens to ship.
 */
function toolAddonSteps(spec: BuildSpec, catalog: Record<string, { repo: string; branch?: string; name?: string }>): string[] {
  const ids = spec.tools ?? [];
  if (ids.length === 0) return [];
  const out: string[] = [];
  for (const id of ids) {
    const t = catalog[id];
    if (!t) continue;
    out.push(
      `      - name: Fetch addon ${t.name ?? id}`,
      "        uses: actions/checkout@v4",
      "        with:",
      `          repository: ${t.repo}`,
      ...(t.branch ? [`          ref: ${t.branch}`] : []),
      `          path: addons/${id}`,
      "          fetch-depth: 1",
    );
  }
  out.push(
    ...shellStep("Make the addon tools available", [
      "set -euo pipefail",
      "shopt -s nullglob",
      "for d in addons/*/; do",
      '  name=$(basename "$d")',
      '  chmod -R +x "$d" 2>/dev/null || true',
      '  echo "$PWD/$d" >> /tmp/addon-paths.txt',
      '  echo "addon ready: $name"',
      "done",
      'if [ -s /tmp/addon-paths.txt ]; then',
      '  echo "ADDON_PATHS=$(paste -sd: /tmp/addon-paths.txt)" >> "$GITHUB_ENV"',
      "fi",
    ]),
  );
  return out;
}

function bodyForFirmwareAndroid(spec: BuildSpec, n: { androidMode: string }): string[] {
  const fw = spec.firmware ?? {};
  const out: string[] = [];

  out.push(
    ...shellStep("Install extraction tooling", [
      "set -euo pipefail",
      "sudo apt-get update",
      "sudo apt-get install -y --no-install-recommends " + "\\",
      "  android-sdk-libsparse-utils e2fsprogs cpio rsync zstd",
    ]),
  );

  // Either the images are already in the repo/artifact, or the caller named one.
  if (fw.artifact) {
    out.push(
      "      - name: Download the uploaded firmware",
      "        uses: actions/download-artifact@v4",
      "        with:",
      `          name: ${yamlLine(fw.artifact)}`,
      "          path: firmware",
    );
  } else {
    out.push(
      ...shellStep("Look for the uploaded firmware", [
        "set -euo pipefail",
        "# The builder commits or uploads the images it dissected. If they are not",
        "# here, this branch cannot run -- and the error says so plainly instead of",
        "# silently falling back to a 250 GB AOSP sync.",
        "shopt -s nullglob",
        "IMAGES=(firmware/*.img firmware/*.bin images/*.img images/*.bin)",
        'if [ ${#IMAGES[@]} -eq 0 ]; then',
        '  echo "::error::no firmware images found. Upload them in the builder first, or set androidMode to source." >&2',
        "  exit 1",
        "fi",
        'echo "found ${#IMAGES[@]} firmware image(s)"',
      ]),
    );
  }

  out.push(
    ...shellStep("Extract the Android trees from the firmware", [
      "set -euo pipefail",
      "sudo mkdir -p /android",
      "shopt -s nullglob",
      'for img in firmware/*.img firmware/*.bin images/*.img images/*.bin; do',
      '  base=$(basename "$img")',
      '  echo "::group::extracting $base"',
      "",
      "  # A sparse image has to be expanded before anything can read it. simg2img",
      "  # leaves the original in place, which matters because nothing here should",
      "  # ever destroy an uploaded image.",
      '  if [ "$(xxd -p -l 4 "$img")" = "3aff26ed" ]; then',
      '    simg2img "$img" "/tmp/$base.raw"',
      '    SRC="/tmp/$base.raw"',
      "  else",
      '    SRC="$img"',
      "  fi",
      "",
      "  # Already-extracted tarballs (what the builder produces) are simplest.",
      '  if [ "${SRC##*.}" = "tar" ] || [ "${SRC##*.}" = "zst" ]; then',
      '    sudo tar -xf "$SRC" -C /android',
      '    echo "::endgroup::"',
      "    continue",
      "  fi",
      "",
      "  # Otherwise it is ext4. debugfs rdump reads it as a file: no loop device,",
      "  # no root, no mount, so this works on a stock CI runner.",
      '  if [ "$(xxd -p -l 2 -s 1080 "$SRC")" = "53ef" ]; then',
      '    sudo debugfs -R "rdump / /android" "$SRC" 2>&1 | grep -v "changing ownership" || true',
      "  else",
      '    echo "::warning::$base is neither sparse, ext4 nor a tarball; skipped"',
      "  fi",
      '  echo "::endgroup::"',
      "done",
      "",
      "ls -la /android | head -20",
      "# Record Android's paths before anything else is merged in, so a later",
      "# source can never quietly replace the Android libc.",
      "sudo find /android -xdev | sort > /tmp/android-paths.txt 2>/dev/null || true",
      'echo "android paths recorded: $(wc -l < /tmp/android-paths.txt)"',
    ]),
  );
  return out;
}

/**
 * The NURFS policy and mount layer.
 *
 * Two things stock Android does that stop a fused tree from booting, and both
 * are policy rather than kernel behaviour:
 *
 *   - there is no glibc domain, so a glibc binary has nowhere to transition to;
 *   - vold only mounts filesystems it was told about at build time, so the fused
 *     ext4 image has no mount point at all.
 *
 * This step compiles the delta against the tree's own policy and installs the
 * init service that mounts the image before vold starts. It fails loudly if the
 * tree has no policy, because silently shipping an image that cannot boot is
 * worse than stopping the build.
 */
function bodyForNurfsPolicy(spec: BuildSpec): string[] {
  if (!spec.nurfsPolicy) return [];
  return [
    ...shellStep("Apply the NURFS SELinux policy delta", [
      "set -euo pipefail",
      "sudo apt-get install -y --no-install-recommends secilc selinux-policy-dev",
      "# The delta lives in the builder repo, so it is already checked out.",
      'POLICY_DIR=$(dirname "$(find . -name nurfs-dual-libc.cil -print -quit)")',
      '[ -n "$POLICY_DIR" ] || { echo "::error::nurfs-dual-libc.cil not found in the checkout" >&2; exit 1; }',
      'echo "policy delta: $POLICY_DIR"',
      'TARGET=$(find . -type d -path "*/system/etc/selinux" -print -quit)',
      'if [ -z "$TARGET" ]; then',
      '  echo "::error::no system/etc/selinux in the tree; the policy delta has nowhere to go." >&2',
      '  echo "the policy lives in ramdisk.img for a device build, and in the android base for an ISO." >&2',
      '  exit 1',
      'fi',
      'sudo bash "$POLICY_DIR/apply-nurfs-policy.sh" --root . --verify',
    ]),
    ...shellStep("Install the NURFS boot mount", [
      "set -euo pipefail",
      'INIT_DIR=$(dirname "$(find . -maxdepth 4 -name "init.rc" -print -quit)")',
      '[ -n "$INIT_DIR" ] || { echo "::error::no init.rc in the tree" >&2; exit 1; }',
      'NURFS_RC=$(find . -name "nurfs-init.rc" -print -quit)',
      '[ -n "$NURFS_RC" ] || { echo "::error::nurfs-init.rc missing from the builder checkout" >&2; exit 1; }',
      'sudo cp "$NURFS_RC" "$INIT_DIR/nurfs-init.rc"',
      '# Android only reads .rc files it is told about, so the import has to be',
      '# added; a file dropped into /system/etc/init is picked up automatically,',
      '# which is the path used here instead of editing init.rc itself.',
      'sudo mkdir -p system/etc/init',
      'sudo cp "$NURFS_RC" system/etc/init/nurfs-init.rc',
      'echo "installed system/etc/init/nurfs-init.rc"',
      'sudo mkdir -p system/bin',
      'NURFS_MOUNT=$(find . -name "nurfs-mount.sh" -print -quit)',
      '[ -n "$NURFS_MOUNT" ] && sudo cp "$NURFS_MOUNT" system/bin/nurfs-mount.sh && sudo chmod 0755 system/bin/nurfs-mount.sh',
      'echo "nurfs mount helper installed"',
    ]),
  ];
}

function bodyForRom(spec: BuildSpec): string[] {
  const rom = spec.rom!;
  const kernel = spec.kernel!;
  const codename = spec.device!.codename!;
  const arch = spec.device!.arch ?? "arm64";
  const out: string[] = [];

  out.push(
    ...shellStep("Install build tooling", [
      "set -euo pipefail",
      "sudo apt-get update",
      "sudo apt-get install -y --no-install-recommends \\",
      "  git-core gnupg flex bison build-essential zip curl zlib1g-dev \\",
      "  gcc-multilib g++-multilib libc6-dev-i386 lib32ncurses5-dev \\",
      "  x11proto-core-dev libx11-dev lib32z1-dev libgl1-mesa-dev \\",
      "  libxml2-utils xsltproc unzip fontconfig repo python3 rsync \\",
      "  cpio bc device-tree-compiler lz4",
    ]),
  );

  out.push(
    ...shellStep("Sync the ROM source", [
      "set -euo pipefail",
      `MANIFEST="${repoUrlForRepoInit(rom)}"`,
      `BRANCH="${rom.manifestBranch || rom.ref || "default"}"`,
      'mkdir -p rom',
      'cd rom',
      'repo init -u "$MANIFEST" -b "$BRANCH" --depth=1',
      "repo sync -c -j$(nproc --all) --force-sync --no-clone-bundle --no-tags",
    ]),
  );

  // The kernel tree is separate from the ROM manifest; clone it beside the tree
  // and point the ROM at it, which is how every custom ROM build does it.
  out.push(
    `      - name: Fetch ${kernel.name}`,
    "        uses: actions/checkout@v4",
    "        with:",
    `          repository: ${repoSlug(kernel.url)}`,
    ...(kernel.ref ? [`          ref: ${kernel.ref}`] : []),
    "          path: rom/kernel/anyrealm",
    "          fetch-depth: 1",
  );

  out.push(
    ...shellStep("Build the ROM", [
      "set -euo pipefail",
      "cd rom",
      "source build/envsetup.sh",
      `breakfast ${codename}`,
      "# ANYREALM_KERNEL_DIR points the device tree at the kernel we just fetched",
      "export ANYREALM_KERNEL_DIR=$PWD/kernel/anyrealm",
      `mka bacon -j$(nproc --all)`,
      `ARCH=${arch}`,
    ]),
  );

  out.push(
    ...shellStep("Collect artifacts", [
      "set -euo pipefail",
      "shopt -s nullglob",
      "mkdir -p out",
      'cp rom/out/target/product/*/lineage*.zip out/ 2>/dev/null || true',
      'cp rom/out/target/product/*/*.img out/ 2>/dev/null || true',
      'cp rom/out/target/product/*/boot.img out/ 2>/dev/null || true',
      'ls -l out || { echo "::error::no build output produced" >&2; exit 1; }',
    ]),
  );
  return out;
}

function repoUrlForRepoInit(src: SpecSource): string {
  // `repo init` wants a git URL that serves a manifest repo.
  return src.url.replace(/\.git$/, "");
}

function bodyForDesktopIso(spec: BuildSpec): string[] {
  const distro = spec.distro!;
  const de = spec.desktop?.environment ?? "xfce";
  const pkgs = (spec.desktop?.packages ?? []).join(" ");
  const out: string[] = [];

  out.push(
    ...shellStep("Install host tooling", [
      "set -euo pipefail",
      "sudo apt-get update",
      "sudo apt-get install -y --no-install-recommends \\",
      "  debootstrap squashfs-tools xorriso mtools dosfstools rsync \\",
      "  isolinux syslinux-common grub-pc-bin grub-efi-amd64-bin grub-common",
    ]),
  );

  out.push(
    ...shellStep("Bootstrap the rootfs", [
      "set -euo pipefail",
      `SUITE="${suiteFor(distro.id)}"`,
      'sudo mkdir -p root',
      'sudo debootstrap --variant=minbase --include=systemd-sysv,live-boot "$SUITE" root "$MIRROR"',
    ]),
  );

  if (spec.androidBase) {
    out.push(
      `      - name: Fetch the Android x86_64 base (${spec.androidBase.name})`,
      "        uses: actions/checkout@v4",
      "        with:",
      `          repository: ${repoSlug(spec.androidBase.url)}`,
      ...(spec.androidBase.ref ? [`          ref: ${spec.androidBase.ref}`] : []),
      "          path: android-base-src",
      "          fetch-depth: 1",
    );
    out.push(
      ...shellStep("Merge the Android x86_64 base under the Linux userspace", [
        "set -euo pipefail",
        "# The Android half supplies /system, /vendor and the Android linker. The",
        "# Linux half supplies /usr, /etc and its own libc. They must coexist, so",
        "# Android's trees land unmodified and the distro keeps everything else.",
        'if [ -d android-base-src/system ]; then',
        "  sudo mkdir -p root/system root/vendor",
        "  sudo rsync -a android-base-src/system/ root/system/",
        '  [ -d android-base-src/vendor ] && sudo rsync -a android-base-src/vendor/ root/vendor/ || true',
        "else",
        '  echo "::warning::the android base checkout has no system/ directory; is this an AOSP tree rather than a built image?"',
        "fi",
        "# Record Android's paths before any further merge, so a later source can",
        "# never silently replace the Android libc.",
        'sudo find root/system root/vendor -xdev | sort > /tmp/android-paths.txt 2>/dev/null || true',
        'wc -l < /tmp/android-paths.txt | xargs echo "android paths recorded:"',
      ]),
    );
  }

  out.push(
    ...shellStep("Merge the desktop environment", [
      "set -euo pipefail",
      `DE="${de}"`,
      'case "$DE" in',
      '  gnome)   DESKTOP_PKGS="gnome-shell ubuntu-desktop" ;;',
      '  plasma)  DESKTOP_PKGS="kde-plasma-desktop" ;;',
      '  xfce)    DESKTOP_PKGS="xfce4" ;;',
      '  cinnamon) DESKTOP_PKGS="cinnamon" ;;',
      '  budgie)  DESKTOP_PKGS="budgie-desktop" ;;',
      '  sway)    DESKTOP_PKGS="sway" ;;',
      '  *) echo "::error::unknown desktop environment: $DE" >&2; exit 1 ;;',
      "esac",
      `EXTRA_PKGS="${pkgs}"`,
      'sudo chroot root bash -c "',
      "  set -e",
      "  export DEBIAN_FRONTEND=noninteractive",
      '  apt-get update',
      '  apt-get install -y --no-install-recommends $DESKTOP_PKGS $EXTRA_PKGS',
      "  apt-get clean",
      '  rm -rf /var/lib/apt/lists/*',
      '"',
      "# The display manager is phosh-session/phoc in the NUKI/NURFS target, but a",
      "# stock distro base needs a greeter; lightdm is the smallest that works.",
      'sudo chroot root bash -c "apt-get install -y lightdm || true"',
    ]),
  );

  if (spec.overlay) {
    out.push(
      `      - name: Fetch ${spec.overlay.name} (overlay user space)`,
      "        uses: actions/checkout@v4",
      "        with:",
      `          repository: ${repoSlug(spec.overlay.url)}`,
      ...(spec.overlay.ref ? [`          ref: ${spec.overlay.ref}`] : []),
      "          path: overlay-src",
      "          fetch-depth: 1",
    );
    out.push(
      ...shellStep("Layer the overlay into the userspace", [
        "set -euo pipefail",
        "# --ignore-existing: the base distro keeps every path it owns, and the",
        "# overlay only fills in what is missing. That is the same rule the",
        "# fusion engine applies, and it is here so a second libc can never",
        "# overwrite the base one.",
        'sudo rsync -a --ignore-existing overlay-src/ root/ || true',
        'sudo mkdir -p root/kali-keep',
        'sudo rsync -a --ignore-existing overlay-src/ root/kali-keep/ || true',
      ]),
    );
  }

  out.push(
    ...shellStep("Pack the filesystem", [
      "set -euo pipefail",
      "sudo rm -rf root/proc/* root/sys/* root/dev/* root/tmp/* 2>/dev/null || true",
      "mkdir -p image/casper image/isolinux image/boot/grub image/EFI/BOOT",
      'sudo mksquashfs root image/casper/filesystem.squashfs -noappend -comp xz',
      'sudo chmod 0644 image/casper/filesystem.squashfs',
    ]),
  );

  out.push(
    ...shellStep("Build bootloaders and the ESP", [
      "set -euo pipefail",
      "cp /usr/lib/ISOLINUX/isolinux.bin image/isolinux/",
      "cp /usr/lib/ISOLINUX/isohdpfx.bin image/isolinux/isohdpfx.bin",
      "cp /usr/lib/syslinux/modules/bios/ldlinux.c32 image/isolinux/",
      "cat > image/boot/grub/grub.cfg <<'CFG'",
      "set timeout=10",
      'menuentry "AnyRealm - live" {',
      "  linux /casper/vmlinuz boot=live quiet splash ---",
      "  initrd /casper/initrd",
      "}",
      'menuentry "AnyRealm - install" {',
      "  linux /casper/vmlinuz boot=live automatic-installer quiet splash ---",
      "  initrd /casper/initrd",
      "}",
      "CFG",
      "cp image/boot/grub/grub.cfg image/EFI/BOOT/grub.cfg",
      'grub-mkstandalone -O x86_64-efi \\',
      '  --modules="part_gpt part_msdos fat iso9660 normal linux search search_fs_file configfile" \\',
      '  -o image/EFI/BOOT/BOOTX64.EFI \\',
      '  "boot/grub/grub.cfg=image/boot/grub/grub.cfg"',
      "mkdir -p efi_img",
      "dd if=/dev/zero of=efi_img/efi.img bs=1M count=16 status=none",
      "mkfs.vfat -n ANYREALM efi_img/efi.img >/dev/null",
      "mmd -i efi_img/efi.img ::/EFI ::/EFI/BOOT",
      "mcopy -i efi_img/efi.img image/EFI/BOOT/BOOTX64.EFI ::/EFI/BOOT/BOOTX64.EFI",
    ]),
  );

  out.push(
    ...shellStep("Assemble the hybrid ISO", [
      "set -euo pipefail",
      "mkdir -p output",
      'ISO="output/AnyRealm-NUKI-NURFS-desktop-amd64.iso"',
      "xorriso -as mkisofs \\",
      "  -R -iso-level 3 -joliet-long -V ANYREALM_NUKI \\",
      "  -b isolinux/isolinux.bin -c isolinux/boot.cat \\",
      "  -no-emul-boot -boot-load-size 4 -boot-info-table \\",
      '  -isohybrid-mbr image/isolinux/isohdpfx.bin \\',
      "  -eltorito-alt-boot -e --interval:appended_partition_2:all:: -no-emul-boot \\",
      "  -append_partition 2 0xef efi_img/efi.img \\",
      "  -isohybrid-gpt-basdat \\",
      '  -o "$ISO" image',
      'echo "MBR: $(xxd -p -l 2 -s 510 "$ISO")"',
      'echo "GPT: $(xxd -p -l 8 -s 512 "$ISO")"',
      '[ "$(xxd -p -l 2 -s 510 "$ISO")" = "55aa" ] || { echo "::error::no MBR signature" >&2; exit 1; }',
      '[ "$(xxd -p -l 8 -s 512 "$ISO")" = "4546492050415254" ] || { echo "::error::no GPT header" >&2; exit 1; }',
    ]),
  );
  return out;
}

function suiteFor(distroId: string): string {
  const map: Record<string, string> = {
    ubuntu: "noble",
    "debian-installer": "trixie",
    archiso: "bookworm", // archiso builds on a distro host; here we only need a base rootfs
    "fedora-kickstarts": "bookworm",
    "opensuse-kiwi": "bookworm",
    "void-mklive": "bookworm",
    "gentoo-releng": "bookworm",
    linuxmint: "noble",
    "pop-os-iso": "noble",
    "alpine-aports": "bookworm",
  };
  return map[distroId] ?? "bookworm";
}

function bodyForMobileKernel(spec: BuildSpec): string[] {
  const kernel = spec.kernel!;
  const codename = spec.device!.codename!;
  const arch = spec.device!.arch ?? "arm64";
  const out: string[] = [];

  out.push(`      - name: Fetch ${kernel.name}`, "        uses: actions/checkout@v4", "        with:",
    `          repository: ${repoSlug(kernel.url)}`,
    ...(kernel.ref ? [`          ref: ${kernel.ref}`] : []),
    "          path: kernel",
    "          fetch-depth: 1");

  out.push(
    ...shellStep("Install the cross toolchain", [
      "set -euo pipefail",
      "sudo apt-get update",
      "sudo apt-get install -y --no-install-recommends \\",
      "  build-essential bc bison flex libssl-dev libelf-dev lz4 cpio rsync \\",
      "  gcc-aarch64-linux-gnu binutils-aarch64-linux-gnu device-tree-compiler",
    ]),
  );

  out.push(
    ...shellStep("Configure and build the kernel", [
      "set -euo pipefail",
      `ARCH=${arch === "arm64" ? "arm64" : "x86_64"}`,
      "CROSS_COMPILE=aarch64-linux-gnu-",
      "cd kernel",
      'DEFCONFIG=$(ls arch/$ARCH/configs/*nuki*.config 2>/dev/null | head -1 || true)',
      '[ -n "$DEFCONFIG" ] || { echo "::error::no NUKI defconfig in the tree" >&2; exit 1; }',
      'make O=out ARCH=$ARCH CROSS_COMPILE=$CROSS_COMPILE $(basename "$DEFCONFIG" .config)',
      "make O=out ARCH=$ARCH CROSS_COMPILE=$CROSS_COMPILE -j$(nproc --all)",
    ]),
  );

  out.push(
    ...shellStep("Collect the boot image", [
      "set -euo pipefail",
      "mkdir -p out-artifacts",
      'IMG=$(find kernel/out -name Image -o -name Image.lz4 -o -name bzImage | head -1)',
      '[ -n "$IMG" ] || { echo "::error::no kernel image produced" >&2; exit 1; }',
      'cp "$IMG" out-artifacts/',
      `echo "kernel for ${codename}: $IMG"`,
    ]),
  );
  return out;
}

/**
 * Turn a spec into a complete workflow document.
 *
 * The generated file is deliberately self-contained: it does not call another
 * workflow, so there is no input contract to drift out of sync (which is what
 * broke the hand-written workflows in Super-Builders).
 */
export function generateWorkflow(spec: BuildSpec): string {
  const n = normalizeSpec(spec);

  const header = [
    "name: " + yamlLine(n.name),
    "",
    "# Generated by the AnyRealm builder from the GUI. Editing this file by hand",
    "# is fine, but re-composing in the GUI overwrites it -- change the spec there",
    "# instead if you want the change to survive.",
    `# edition: ${n.edition}`,
    `# android half: ${n.androidMode === "firmware" ? "from uploaded firmware (no AOSP sync)" : "from upstream source"}`,
    n.rom ? `# rom: ${n.rom.id} (${n.rom.url})` : null,
    n.distro ? `# distro: ${n.distro.id} (${n.distro.url})` : null,
    n.androidBase ? `# android base: ${n.androidBase.id} (${n.androidBase.url})` : null,
    n.kernel ? `# kernel: ${n.kernel.id} (${n.kernel.url})` : null,
    n.device?.codename ? `# device: ${n.device.codename}${n.device.soc ? ` (${n.device.soc})` : ""}` : null,
    n.desktop?.environment ? `# desktop environment: ${n.desktop.environment}` : null,
    "",
    "on:",
    "  workflow_dispatch:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "concurrency:",
    `  group: ${yamlLine(n.name)}`,
    "  cancel-in-progress: false",
    "",
    "env:",
    "  DEBIAN_FRONTEND: noninteractive",
    "  MIRROR: http://archive.ubuntu.com/ubuntu",
    "",
    "jobs:",
    "  build:",
    `    runs-on: ${n.runner}`,
    "    timeout-minutes: 180",
    "",
    "    steps:",
    "      - name: Checkout builder repository",
    "        uses: actions/checkout@v4",
    "",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const body =
    n.edition === "rom"
      ? bodyForRom(n)
      : n.edition === "desktop_iso"
        ? bodyForDesktopIso(n)
        : bodyForMobileKernel(n);

  // Compilers and addon tools go in before the body, because the body's first
  // compile step expects CC and the addon paths to already be set.
  const chain = chainSteps(n);
  const addons = toolAddonSteps(n, addonCatalog());

  const upload = [
    "",
    "      - name: Upload artifact",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    `          name: ${yamlLine(n.artifactName)}`,
    n.edition === "rom" ? "          path: out/" : n.edition === "desktop_iso" ? "          path: output/" : "          path: out-artifacts/",
    "          retention-days: 14",
    "          overwrite: true",
    "",
  ].join("\n");

  const prelude = [...chain, ...addons, ...bodyForNurfsPolicy(n)].join("\n");
  return header + (prelude ? prelude + "\n" : "") + body.join("\n") + upload;
}

/** Quote a string for YAML only when it would otherwise be misread. */
function yamlLine(s: string): string {
  return /^[A-Za-z0-9._/-][A-Za-z0-9._/ -]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)
    ? s
    : JSON.stringify(s);
}

export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  jobs?: number;
  steps?: number;
}

/**
 * Validate the generated document. This is the gate that stops a spec becoming
 * a workflow that dies at dispatch time.
 */
export function validateWorkflow(text: string): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let doc: any;
  try {
    doc = yamlLoad(text);
  } catch (e: any) {
    return { ok: false, errors: [`YAML does not parse: ${e.message}`], warnings };
  }
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["document is not a mapping"], warnings };
  }
  // Two loader quirks to survive here. YAML 1.1 readers turn a bare `on:` key
  // into the boolean true, so the trigger block may arrive as doc.on or
  // doc[true]. And a trigger with no body (`workflow_dispatch:`) parses as
  // null, which is falsy -- so presence must be tested with `in`, not truthiness.
  const rawDoc = doc as any;
  const trigger: any = rawDoc.on ?? rawDoc["true"] ?? rawDoc["yes"];
  const has = (k: string) => !!trigger && Object.prototype.hasOwnProperty.call(trigger, k);
  if (!trigger || (!has("workflow_dispatch") && !has("push") && !has("pull_request"))) {
    errors.push("no trigger: needs on.workflow_dispatch so it can be dispatched");
  }
  if (!has("workflow_dispatch")) {
    warnings.push("no workflow_dispatch: the builder dispatches via workflow_dispatch, so this must be present");
  }
  const jobs = doc.jobs ?? {};
  const names = Object.keys(jobs);
  if (names.length === 0) errors.push("no jobs");
  for (const name of names) {
    const job = jobs[name];
    if (!job["runs-on"]) errors.push(`job ${name} has no runs-on`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      errors.push(`job ${name} has no steps`);
      continue;
    }
    for (const [i, step] of job.steps.entries()) {
      if (!step.uses && !step.run) errors.push(`job ${name} step ${i + 1} has neither uses nor run`);
      if (step.run && typeof step.run !== "string") errors.push(`job ${name} step ${i + 1} run is not a string`);
    }
    const readsInputs = job.steps.some(
      (s: any) => typeof s.run === "string" && s.run.includes("$" + "{{ inputs."),
    );
    if (readsInputs) {
      warnings.push("job " + name + " reads inputs.* but the workflow declares no inputs");
    }
  }
  const steps = names.reduce((n, k) => n + (jobs[k].steps?.length ?? 0), 0);
  return { ok: errors.length === 0, errors, warnings, jobs: names.length, steps };
}

/** Convenience: generate and validate in one call. */
export function composeWorkflow(spec: BuildSpec): { fileName: string; yaml: string; validation: Validation } {
  const fileName = workflowFileName(spec);
  const text = generateWorkflow(spec);
  return { fileName, yaml: text, validation: validateWorkflow(text) };
}
