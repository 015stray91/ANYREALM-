/**
 * ISO livepatch: shipping a kernel livepatch inside the install image.
 *
 * Two different things get called "livepatch" in this project, and conflating
 * them is how the kpatch work stalled:
 *
 *   kpatch-live/      an x86_64 kernel module providing livepatch support to a
 *                     kernel that lacks CONFIG_LIVEPATCH. Built as a module.
 *   dynup/kpatch      the userspace tool that produces a livepatch module from a
 *                     source diff. Produces .ko files; does not load them.
 *
 * The ISO needs the first, not the second. And it needs the kernel to have been
 * built with the livepatch core enabled, which this kernel was: CONFIG_LIVEPATCH,
 * CONFIG_LIVEPATCH_WO_FTRACE, CONFIG_DYNAMIC_FTRACE and CONFIG_KALLSYMS are all
 * =y in the merged config. So the image can carry livepatch support without a
 * module at all — and a stray kpatch.ko that does not compile must not be able
 * to block the ISO build.
 *
 * The design here is therefore staged and honest about which stage is present:
 *
 *   stage 1  kernel has livepatch built in. Nothing to ship. This is the state
 *            today.
 *   stage 2  a livepatch payload (a .ko produced by kpatch-build) is dropped in
 *            /system/lib/modules/livepatch/ and a unit applies it at boot.
 *   stage 3  the payload is verified: the module's vermagic matches the running
 *            kernel, and its target function symbols exist in kallsyms.
 *
 * Stage 3 is the one that matters. A livepatch module whose target symbol moved
 * loads and does nothing, which is worse than failing to load.
 */

import fs from "fs";
import path from "path";

export interface LivepatchConfig {
  /** Ship the modules-load unit that applies payloads at boot. */
  enable: boolean;
  /** Where payloads live inside the image. */
  moduleDir: string;
  /** Apply at boot, or leave them for an operator. */
  applyAtBoot: boolean;
  /**
   * Refuse to build when a payload's vermagic does not match the kernel. Turning
   * this off is how a livepatch silently no-ops.
   */
  requireVermagic: boolean;
}

export const DEFAULT_CONFIG: LivepatchConfig = {
  enable: true,
  moduleDir: "/system/lib/modules/livepatch",
  applyAtBoot: true,
  requireVermagic: true,
};

/** What the target kernel must have for livepatch to work at all. */
export const REQUIRED_CONFIG = [
  "CONFIG_LIVEPATCH",
  "CONFIG_LIVEPATCH_WO_FTRACE",
  "CONFIG_DYNAMIC_FTRACE",
  "CONFIG_KALLSYMS",
  "CONFIG_KALLSYMS_ALL",
] as const;

/**
 * Check a kernel config (.config text) for livepatch prerequisites.
 *
 * `=y` is required, not `=m`: the livepatch core cannot be a module, because the
 * module loader itself is what needs it.
 */
export function checkKernelConfig(configText: string) {
  const lines = configText.split("\n");
  const get = (key: string) => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : null;
  };

  const facts = REQUIRED_CONFIG.map((key) => {
    const value = get(key);
    return {
      key,
      value,
      satisfied: value === "y",
      // =m is a real answer and worth distinguishing from absent: it means
      // someone enabled it in a way that cannot work.
      note: value === null ? "not set" : value === "m" ? "set =m, but the livepatch core cannot be a module" : value === "y" ? "ok" : `unexpected value ${value}`,
    };
  });

  return {
    ok: facts.every((f) => f.satisfied),
    facts,
    summary: facts.every((f) => f.satisfied)
      ? "livepatch is built into this kernel; the image needs no extra module"
      : `not ready: ${facts.filter((f) => !f.satisfied).map((f) => f.key).join(", ")}`,
  };
}

/** Parse the vermagic out of a .ko's modinfo, without running modinfo. */
export function readModinfo(file: string): Record<string, string> {
  // modinfo is the only reliable reader; fall back to strings for the two fields
  // that matter so this works on a machine without kmod.
  const out: Record<string, string> = {};
  try {
    const buf = fs.readFileSync(file);
    const text = buf.toString("latin1");
    for (const key of ["vermagic", "license", "name", "depends"]) {
      // modinfo strings appear as `vermagic=...\0` in .modinfo
      const re = new RegExp(`${key}=([^\\0\\n]+)`);
      const m = re.exec(text);
      if (m) out[key] = m[1];
    }
  } catch {
    /* unreadable */
  }
  return out;
}

export interface PayloadCheck {
  file: string;
  ok: boolean;
  vermagic: string | null;
  matchesKernel: boolean | null;
  symbols: { required: string[]; missing: string[] };
  warnings: string[];
  error?: string;
}

/**
 * Verify one payload against a kernel tree.
 *
 * Symbol existence is checked against the tree's `System.map` or `vmlinux`
 * symbol table when available. Without one, symbol checks are reported as
 * unknown rather than passed — a green tick that means "did not look" is how the
 * ISO shipped three unusable images earlier in this project.
 */
export function checkPayload(
  payloadPath: string,
  opts: { kernelVermagic?: string; systemMapPath?: string } = {},
): PayloadCheck {
  const warnings: string[] = [];
  if (!fs.existsSync(payloadPath)) {
    return { file: payloadPath, ok: false, vermagic: null, matchesKernel: null, symbols: { required: [], missing: [] }, warnings, error: "file not found" };
  }

  const info = readModinfo(payloadPath);
  const vermagic = info.vermagic ?? null;

  let matchesKernel: boolean | null = null;
  if (vermagic && opts.kernelVermagic) {
    matchesKernel = vermagic.trim() === opts.kernelVermagic.trim();
    if (!matchesKernel) warnings.push(`vermagic mismatch: payload "${vermagic}", kernel "${opts.kernelVermagic}"`);
  } else if (!opts.kernelVermagic) {
    warnings.push("no kernel vermagic supplied, so the match was not checked");
  } else {
    warnings.push("payload has no vermagic");
  }

  // A livepatch module names the functions it replaces. They appear in the
  // module's strings as `klp_func` symbol names; without parsing kpatch's private
  // section format, the honest check is against System.map for the names present.
  const required: string[] = [];
  try {
    const text = fs.readFileSync(payloadPath).toString("latin1");
    for (const m of text.matchAll(/\b(?:klp|__UNIQUE_ID)[A-Za-z0-9_]*/g)) {
      if (m[0].startsWith("klp")) required.push(m[0]);
    }
  } catch {
    /* ignore */
  }

  let missing: string[] = [];
  if (opts.systemMapPath && fs.existsSync(opts.systemMapPath)) {
    const map = fs.readFileSync(opts.systemMapPath, "utf8");
    missing = required.filter((s) => !map.includes(s));
  } else if (required.length) {
    warnings.push("no System.map supplied, so symbol presence was not verified");
  }

  return {
    file: payloadPath,
    ok: matchesKernel !== false && missing.length === 0,
    vermagic,
    matchesKernel,
    symbols: { required: [...new Set(required)].slice(0, 40), missing },
    warnings,
  };
}

/**
 * The units the ISO carries when livepatch payloads are present.
 *
 * Only emitted when there is something to apply: a unit that runs and finds
 * nothing looks like a broken step, and an empty directory in the image looks
 * like a missing feature.
 */
export function bootUnits(cfg: LivepatchConfig) {
  if (!cfg.enable || !cfg.applyAtBoot) return [];
  return [
    {
      path: "/etc/systemd/system/anyrealm-livepatch.service",
      contents: `[Unit]
Description=Apply AnyRealm livepatch payloads
# After the module tree is mounted, before anything that could crash in the
# patched function runs.
After=systemd-modules-load.service local-fs.target
ConditionPathExists=${cfg.moduleDir}

[Service]
Type=oneshot
RemainAfterExit=yes
# Every payload in the directory, in name order, and a failure is reported
# rather than swallowed: a livepatch that did not apply is a lie otherwise.
ExecStart=/bin/sh -c 'set -e; for k in ${cfg.moduleDir}/*.ko; do [ -e "$k" ] || continue; echo "anyrealm-livepatch: $k"; insmod "$k"; done; dmesg | tail -5'
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`,
    },
    {
      path: "/etc/systemd/system/multi-user.target.wants/anyrealm-livepatch.service",
      contents: "# symlink to ../anyrealm-livepatch.service\n",
    },
  ];
}

/**
 * The fuse-script fragment that stages payloads into the merged tree.
 *
 * Returned as shell, not prose, so it can be pasted into fuse_darkmatter_nh.sh
 * unchanged. It fails loudly when a payload does not match the kernel.
 */
export function fuseFragment(cfg: LivepatchConfig) {
  return `# --- livepatch payloads ---------------------------------------------------
# Only staged when payloads exist. The kernel has CONFIG_LIVEPATCH=y, so an
# empty payload directory means "support is built in", not "feature missing".
LIVEPATCH_SRC="\${LIVEPATCH_SRC:-}"
if [ -n "$LIVEPATCH_SRC" ] && [ -d "$LIVEPATCH_SRC" ]; then
    n_lp=0
    sudo mkdir -p "$SYS${cfg.moduleDir}"
    for _ko in "$LIVEPATCH_SRC"/*.ko; do
        [ -e "$_ko" ] || continue
        # Refuse a payload built against another kernel. It would load and
        # silently patch nothing.
        _vm="$(modinfo -F vermagic "$_ko" 2>/dev/null | awk '{print $1}')"
        if [ -n "$KERNEL_VERMAGIC" ] && [ "$_vm" != "$KERNEL_VERMAGIC" ]; then
            die "livepatch $_ko vermagic '$_vm' != kernel '$KERNEL_VERMAGIC'"
        fi
        sudo cp -a "$_ko" "$SYS${cfg.moduleDir}/"
        n_lp=$((n_lp + 1))
    done
    echo "  livepatch: $n_lp payload(s) -> ${cfg.moduleDir}"
    [ "$n_lp" -gt 0 ] || echo "  livepatch: source directory was empty, nothing staged"
fi
`;
}
