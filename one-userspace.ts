/**
 * The one-userspace invariant.
 *
 * Every AnyRealm artefact is one user space. Not a base system with a second one
 * bolted on, not a chroot, not a container image, not a VM disk. That is the
 * whole point of NUKI/NURFS, and it is the thing that quietly goes wrong: a
 * stray `bin/busybox` that shells out to `chroot`, a leftover `proot` binary
 * dragged in by a NetHunter user-space layer, a `virgl` or `waydroid` session
 * config, a `stratum` directory that makes the fusion engine's isolation look
 * like Bedrock's runtime fetch.
 *
 * The difference from Bedrock matters here and is worth stating, because the
 * comparison invites confusion. Bedrock Linux fetches strata at runtime and
 * redirects them into a shared filesystem with a shim layer; the strata remain
 * separate installations underneath. AnyRealm fuses at build time: the merge
 * happens once, to real files, in one tree, and there is no shim, no redirector
 * and no second installation at run time. What ships is what runs.
 *
 * So this check exists to keep the build honest. It inspects an assembled tree
 * and fails when it finds the machinery of a second user space. Because the
 * artefacts it inspects are the build's own output, a failure here means the
 * builder produced something that contradicts the project's definition of
 * itself -- which is worth stopping a release over.
 */

import fs from "fs";
import path from "path";

export interface InvariantFinding {
  /** What kind of second-user-space machinery was found. */
  kind:
    | "container-runtime"
    | "chroot-tool"
    | "proot"
    | "vm-image"
    | "nested-rootfs"
    | "overlay-redirector"
    | "foreign-init"
    | "second-libc-tree";
  /** Path relative to the inspected root. */
  path: string;
  /** Why this counts as a second user space. */
  reason: string;
  /** How bad it is. "error" fails the build, "warn" is reported only. */
  severity: "error" | "warn";
}

export interface InvariantReport {
  ok: boolean;
  root: string;
  findings: InvariantFinding[];
  /** Directories that look like a nested root, and why they were tolerated. */
  inspected: number;
  durationMs: number;
}

/**
 * Binaries that exist to start a second user space.
 *
 * These are matched as whole path segments under a `bin`/`sbin` directory, so
 * `usr/bin/nsenter` matches and `usr/lib/libproot-helper.so` does not. The list
 * is deliberately about *purpose*, not about packaging: a legitimate tool that
 * happens to contain the substring (like `docker-compose` in a docs folder) is
 * only a finding when it sits in an executable path.
 */
const CONTAINER_BINARIES = new Set([
  "docker",
  "podman",
  "nerdctl",
  "ctr",
  "containerd",
  "runc",
  "crun",
  "lxc-start",
  "lxc-create",
  "lxc-attach",
  "lxc-execute",
  "systemd-nspawn",
  "machinectl",
  "bwrap",
  "bubblewrap",
  "firejail",
  "nsenter",
  "unshare",
]);

const CHROOT_BINARIES = new Set(["chroot", "chroot.sh", "fakechroot", "chrootify"]);

const PROOT_BINARIES = new Set(["proot", "proot.sh", "termux-chroot"]);

/**
 * Files whose presence means a second user space is expected to run nested.
 *
 * `waydroid` is included because it is a container-based Android on Linux; in an
 * AnyRealm image the Android half is native, so a waydroid install is either a
 * leftover or a sign the build took the wrong path entirely.
 */
const NESTED_MARKERS = [
  { file: "var/lib/lxc", kind: "nested-rootfs" as const, reason: "an LXC stratum tree; AnyRealm fuses at build time, it does not keep strata" },
  { file: "var/lib/docker", kind: "container-runtime" as const, reason: "a container store in a shipped image" },
  { file: "var/lib/waydroid", kind: "nested-rootfs" as const, reason: "Waydroid runs Android in a container; this image's Android half is native" },
  { file: "data/waydroid", kind: "nested-rootfs" as const, reason: "Waydroid data directory" },
  { file: "var/lib/machines", kind: "nested-rootfs" as const, reason: "systemd-nspawn machine store" },
  { file: "etc/chroot.d", kind: "chroot-tool" as const, reason: "configuration for chroot-style second roots" },
];

/**
 * Overlay redirectors. A rootfs that ships one of these is behaving like Bedrock
 * at run time, which is the specific thing AnyRealm is not.
 */
const REDIRECTOR_MARKERS = [
  { file: "etc/brl", kind: "overlay-redirector" as const, reason: "Bedrock's brl redirector: the runtime-fetch model AnyRealm replaces with a build-time fuse" },
  { file: "usr/share/bedrock", kind: "overlay-redirector" as const, reason: "Bedrock strata metadata" },
  { file: "etc/bedrock", kind: "overlay-redirector" as const, reason: "Bedrock configuration" },
  { file: "etc/proot", kind: "proot" as const, reason: "proot configuration" },
];

/** Init systems that are not the one this image boots. */
const FOREIGN_INITS = [
  { file: "sbin/openrc-init", reason: "OpenRC is installed but this image boots a different init" },
  { file: "usr/bin/systemd-nspawn", reason: "systemd's container init" },
];

/**
 * Image files that are a second root inside a root.
 *
 * An `.img`, `.qcow2` or `.vdi` under an ordinary directory is a nested
 * filesystem; the exception is a Moto/vendor `boot.img`-style artefact, which is
 * a kernel image and not a user space.
 */
const VM_IMAGE_EXT = new Set([".qcow2", ".vdi", ".vmdk", ".vhd", ".vhdx", ".ova", ".ovf"]);

interface WalkEntry {
  rel: string;
  abs: string;
  isDir: boolean;
  size: number;
}

/** Walk without following symlinks, capped so a bad tree cannot run forever. */
function walk(root: string, limit = 400_000): WalkEntry[] {
  const out: WalkEntry[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: "" }];
  let visited = 0;
  while (stack.length) {
    const { abs, rel } = stack.pop()!;
    if (++visited > limit) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(childAbs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        // A symlink is recorded but not entered: following it is how a scan of a
        // rootfs walks into the host's /proc and reports nonsense.
        out.push({ rel: childRel, abs: childAbs, isDir: false, size: 0 });
        continue;
      }
      if (st.isDirectory()) {
        out.push({ rel: childRel, abs: childAbs, isDir: true, size: 0 });
        stack.push({ abs: childAbs, rel: childRel });
      } else if (st.isFile()) {
        out.push({ rel: childRel, abs: childAbs, isDir: false, size: st.size });
      }
    }
  }
  return out;
}

/** True when the path is a real executable location, not a docs or source path. */
function isExecutablePath(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.length < 2) return false;
  // Accept bin/sbin in any prefix: /bin, /usr/bin, /system/bin, /vendor/bin.
  const dir = parts[parts.length - 2];
  return dir === "bin" || dir === "sbin" || dir === "xbin" || dir === "libexec";
}

/**
 * Check one assembled tree.
 *
 * `allow` lets a caller waive a specific finding by path, so a deliberate
 * decision (shipping `unshare` because a NetworkManager plugin links it) does not
 * need the check disabled wholesale.
 */
export function checkOneUserspace(
  root: string,
  opts: { allow?: string[]; warnOnly?: boolean } = {},
): InvariantReport {
  const started = Date.now();
  const absRoot = path.resolve(root);
  const allow = new Set((opts.allow ?? []).map((p) => p.replace(/^\/+/, "")));
  const findings: InvariantFinding[] = [];

  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    throw new Error(`not a directory: ${absRoot}`);
  }

  const entries = walk(absRoot);
  const push = (f: InvariantFinding) => {
    if (allow.has(f.path)) return;
    findings.push({ ...f, severity: opts.warnOnly ? "warn" : f.severity });
  };

  // --- binaries that start a second user space ------------------------------
  for (const e of entries) {
    if (e.isDir) continue;
    const base = path.basename(e.rel);
    if (!isExecutablePath(e.rel)) continue;

    if (CONTAINER_BINARIES.has(base)) {
      // unshare and nsenter are also ordinary utilities that legitimate system
      // software links against, so they warn rather than fail. docker, runc and
      // lxc-start have no such defence.
      const soft = base === "unshare" || base === "nsenter";
      push({
        kind: "container-runtime",
        path: e.rel,
        reason: `${base} starts or enters a namespace-separated user space, which contradicts a single fused root`,
        severity: soft ? "warn" : "error",
      });
    }
    if (CHROOT_BINARIES.has(base)) {
      const soft = base === "chroot";
      push({
        kind: "chroot-tool",
        path: e.rel,
        reason: `${base} swaps the root directory; AnyRealm ships one root, not a base plus chroots`,
        // Plain chroot is in coreutils and turns up in rescue tooling, so it is
        // reported rather than fatal. fakechroot and chroot.sh have no other use.
        severity: soft ? "warn" : "error",
      });
    }
    if (PROOT_BINARIES.has(base)) {
      push({
        kind: "proot",
        path: e.rel,
        reason: `${base} emulates a root with ptrace; the fused tree needs no emulation`,
        severity: "error",
      });
    }
  }

  // --- disk images ---------------------------------------------------------
  //
  // Deliberately not inside the executable-path guard above: a .qcow2 lives in
  // /var/lib/libvirt/images, not /usr/bin, and a disk image is a second user
  // space wherever it sits. The extension is the signal, not the size -- gating
  // on size would let a small image through.
  for (const e of entries) {
    if (e.isDir) continue;
    const ext = path.extname(e.rel).toLowerCase();
    if (!VM_IMAGE_EXT.has(ext)) continue;
    // Anything under 512 bytes is a placeholder or a truncated file, not a
    // usable disk image.
    if (e.size < 512) continue;
    push({
      kind: "vm-image",
      path: e.rel,
      reason: `a ${ext} disk image is a second user space inside this one`,
      severity: "error",
    });
  }

  // --- directory markers ---------------------------------------------------
  for (const m of NESTED_MARKERS) {
    const abs = path.join(absRoot, m.file);
    if (fs.existsSync(abs)) {
      push({ kind: m.kind, path: m.file, reason: m.reason, severity: "error" });
    }
  }
  for (const m of REDIRECTOR_MARKERS) {
    const abs = path.join(absRoot, m.file);
    if (fs.existsSync(abs)) {
      push({ kind: m.kind, path: m.file, reason: m.reason, severity: "error" });
    }
  }
  for (const m of FOREIGN_INITS) {
    const abs = path.join(absRoot, m.file);
    if (fs.existsSync(abs)) {
      push({ kind: "foreign-init", path: m.file, reason: m.reason, severity: "warn" });
    }
  }

  // --- a second libc tree ---------------------------------------------------
  //
  // One libc is normal. Two complete libc trees at the same prefix is a second
  // user space wearing the first one's clothes, and it is the failure mode the
  // fusion engine's PROTECTED list exists to prevent. Both are legitimate here
  // only when they are in different trees (bionic in /system, glibc in /usr).
  const glibcLoaders = entries.filter(
    (e) => !e.isDir && /^lib(64)?\/ld-linux[^/]*\.so/.test(e.rel),
  );
  const muslLoaders = entries.filter((e) => !e.isDir && /^lib(64)?\/ld-musl[^/]*\.so/.test(e.rel));
  if (glibcLoaders.length > 0 && muslLoaders.length > 0) {
    push({
      kind: "second-libc-tree",
      path: "lib",
      reason: `both glibc (${glibcLoaders.map((e) => e.rel).join(", ")}) and musl (${muslLoaders
        .map((e) => e.rel)
        .join(", ")}) loaders sit at the root prefix; one of them cannot be reached by any binary`,
      severity: "error",
    });
  }

  const errors = findings.filter((f) => f.severity === "error");
  return {
    ok: errors.length === 0,
    root: absRoot,
    findings,
    inspected: entries.length,
    durationMs: Date.now() - started,
  };
}

/** Human-readable report, for the API response and a build log. */
export function renderInvariantReport(r: InvariantReport): string {
  const lines: string[] = [];
  lines.push(`one-userspace check: ${r.ok ? "PASS" : "FAIL"}`);
  lines.push(`  root: ${r.root}`);
  lines.push(`  entries inspected: ${r.inspected}`);
  lines.push(`  duration: ${r.durationMs}ms`);
  if (r.findings.length === 0) {
    lines.push("  nothing that starts a second user space was found");
    return lines.join("\n");
  }
  const errors = r.findings.filter((f) => f.severity === "error");
  const warns = r.findings.filter((f) => f.severity === "warn");
  if (errors.length) {
    lines.push(`  ${errors.length} error(s):`);
    for (const f of errors) lines.push(`    [${f.kind}] ${f.path} -- ${f.reason}`);
  }
  if (warns.length) {
    lines.push(`  ${warns.length} warning(s):`);
    for (const f of warns) lines.push(`    [${f.kind}] ${f.path} -- ${f.reason}`);
  }
  return lines.join("\n");
}
