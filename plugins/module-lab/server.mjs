/**
 * LKM / KPM Module Lab.
 *
 * Two module formats matter to this project and they are not the same thing:
 *
 *   LKM  .ko   built against a kernel tree, loaded with insmod, checked by
 *              vermagic and the symbol table. One bad vermagic and the module
 *              refuses to load at boot with a line in dmesg nobody reads.
 *   KPM  .kpm  KernelPatch modules. arm64 only. Not ELF-kernel-ABI-bound the
 *              way a .ko is; they are loaded by kpatch and hook the kernel at
 *              runtime. Treating one like a .ko is a category error.
 *
 * The lab therefore reports the *format* first and judges against that format's
 * rules second. It also scaffolds a buildable module, because the common failure
 * here is not a bad module, it is a module built against the wrong tree.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";

const KPM_MAGIC = Buffer.from("KPM", "ascii");

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function isElf(buf) {
  return buf.length > 4 && buf[0] === 0x7f && buf.subarray(1, 4).toString("ascii") === "ELF";
}

function elfClass(buf) {
  if (!isElf(buf)) return null;
  const cls = buf[4]; // 1 = 32-bit, 2 = 64-bit
  const data = buf[5]; // 1 = little endian
  return { bits: cls === 2 ? 64 : 32, littleEndian: data === 1 };
}

/** Parse `modinfo` output into a map. Missing files produce an empty map. */
async function modinfo(file) {
  const r = await run("modinfo", [file]);
  const out = {};
  if (!r.ok) return out;
  for (const line of r.stdout.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      (out[k] ??= []).push(v);
    }
  }
  return out;
}

/**
 * The kernel's module loader compares vermagic as a string, so the only honest
 * check is string equality against the kernel we are targeting. A mismatch is
 * reported as an exact diff rather than "incompatible".
 */
function vermagicVerdict(moduleVermagic, kernelVermagic) {
  if (!moduleVermagic) return { match: false, reason: "module has no vermagic (not a loadable .ko?)" };
  if (!kernelVermagic) return { match: null, reason: "no target kernel vermagic supplied" };
  const a = moduleVermagic.split(/\s+/).filter(Boolean);
  const b = kernelVermagic.split(/\s+/).filter(Boolean);
  const onlyA = a.filter((x) => !b.includes(x));
  const onlyB = b.filter((x) => !a.includes(x));
  const match = onlyA.length === 0 && onlyB.length === 0;
  return {
    match,
    moduleOnly: onlyA,
    kernelOnly: onlyB,
    reason: match ? "identical" : `module-only: ${onlyA.join(" ") || "—"}; kernel-only: ${onlyB.join(" ") || "—"}`,
  };
}

export async function register(ctx) {
  const tmpDir = () => {
    const d = path.join(ctx.workDir(), "uploads");
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  /** What the panel renders: formats, tools, and what a module needs. */
  ctx.route("/catalog", (_req, res) => {
    res.json({
      formats: [
        {
          id: "lkm",
          label: ".ko — Linux kernel module",
          arch: "any",
          load: "insmod (or a modules-load unit at boot)",
          checks: ["ELF machine matches the kernel", "vermagic string equality", "undefined symbols resolvable", "license in modinfo"],
          notes: [
            "Built against one kernel tree; a patch-level difference in vermagic is enough to refuse.",
            "This project's desktop kernel is x86_64 6.12; the mobile kernel is arm64 5.10.240. Never cross them.",
          ],
        },
        {
          id: "kpm",
          label: ".kpm — KernelPatch module",
          arch: "arm64",
          load: "kpatch (arm64). Not insmod.",
          checks: ["target arch is arm64", "kernel version range declared by the module", "hook target symbols present in the target kernel"],
          notes: [
            "Runtime kernel hooking, not an ABI-bound ELF. x86_64 has no KPM loader here (kpatch-live is a different mechanism).",
            "A .kpm loaded on x86_64 is a no-op at best; there is no loader for it.",
          ],
        },
      ],
      tools: ctx.manifest.requires.map((t) => ({ tool: t, path: ctx.which(t) })),
      buildTemplates: ["minimal-kmod", "kprobe-observable", "sysfs-knob"],
    });
  });

  /**
   * Inspect one uploaded module. The buffer is passed as base64 because this is
   * a JSON API and modules are small (tens of KB), unlike firmware images.
   */
  ctx.route("/inspect", async (req, res) => {
    const { name = "module", dataBase64 = "", kernelVermagic = "" } = req.body ?? {};
    if (!dataBase64) return res.status(400).json({ error: "dataBase64 is required" });

    let buf;
    try {
      buf = Buffer.from(String(dataBase64), "base64");
    } catch {
      return res.status(400).json({ error: "dataBase64 is not valid base64" });
    }
    if (buf.length === 0) return res.status(400).json({ error: "empty module" });

    const safe = path.basename(String(name)).replace(/[^A-Za-z0-9._-]/g, "_");
    const saved = path.join(tmpDir(), `${Date.now()}-${safe}`);
    fs.writeFileSync(saved, buf);

    const facts = { name: safe, bytes: buf.length, elf: isElf(buf), kpm: buf.subarray(0, 3).equals(KPM_MAGIC) };
    const notes = [];
    const warnings = [];

    if (facts.kpm) {
      facts.format = "kpm";
      facts.arch = "arm64 (by format)";
      notes.push("KernelPatch module: loaded by kpatch, not insmod.");
      const strings = (await run("strings", [saved])).stdout.split("\n");
      const range = strings.find((s) => /^\d+\.\d+(\.\d+)?/.test(s.trim()));
      if (range) notes.push(`declared kernel version string: ${range.trim()}`);
      if (kernelVermagic && !kernelVermagic.includes("aarch64") && !kernelVermagic.includes("arm64")) {
        warnings.push("a KPM targets arm64; the supplied kernel vermagic does not look like arm64");
      }
      facts.savedPath = saved;
      return res.json({ ok: true, facts, notes, warnings, vermagic: null });
    }

    if (!facts.elf) {
      facts.format = "unknown";
      warnings.push(`not an ELF and not a KPM (first bytes: ${buf.subarray(0, 8).toString("hex")})`);
      return res.json({ ok: false, facts, notes, warnings, vermagic: null });
    }

    facts.format = "lkm";
    const cls = elfClass(buf);
    facts.arch = cls?.bits === 64 ? "x86_64/arm64 (64-bit ELF)" : "32-bit ELF";

    const info = await modinfo(saved);
    facts.modinfo = {
      license: info.license?.join(", "),
      description: info.description?.join(", "),
      author: info.author?.join(", "),
      depends: info.depends?.join(",") || "",
      parm: info.parm?.length ?? 0,
      alias: info.alias?.length ?? 0,
    };
    facts.vermagic = info.vermagic?.[0] ?? null;
    facts.depends = (info.depends?.[0] ?? "").split(",").filter(Boolean);

    if (!facts.vermagic) warnings.push("no vermagic in modinfo — this may not be a loadable module");
    if (facts.modinfo.license === "GPL" || facts.modinfo.license === "Dual MIT/GPL") {
      notes.push("GPL-compatible license: symbols marked EXPORT_SYMBOL_GPL are usable.");
    } else if (facts.modinfo.license) {
      warnings.push(`license "${facts.modinfo.license}" is not GPL — GPL-only symbols will refuse to resolve`);
    } else {
      warnings.push("no license field; the kernel will taint as proprietary and GPL-only symbols will fail");
    }

    const verdict = vermagicVerdict(facts.vermagic, String(kernelVermagic).trim());
    if (verdict.match === false) warnings.push(`vermagic mismatch — ${verdict.reason}`);

    // Undefined symbols: these are what the kernel must provide at insmod time.
    const nm = await run("nm", ["-u", saved]);
    const undefinedSymbols = nm.ok
      ? nm.stdout
          .split("\n")
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((s) => s && s !== "U")
      : [];
    facts.undefinedSymbols = undefinedSymbols.length;
    facts.undefinedSample = undefinedSymbols.slice(0, 40);

    const rel = await run("readelf", ["-h", saved]);
    if (rel.ok) {
      const type = /Type:\s+(\S+)/.exec(rel.stdout)?.[1];
      if (type && type !== "REL") {
        warnings.push(`ELF type is ${type}, modules must be REL (relocatable)`);
      }
    }

    facts.savedPath = saved;
    res.json({ ok: true, facts, notes, warnings, vermagic: verdict });
  });

  /**
   * Scaffold a buildable out-of-tree module. The point is the Makefile pointing
   * at an explicit KDIR: the classic failure is `make -C /lib/modules/$(uname
   * -r)/build`, which builds against the host's kernel, not the target's.
   */
  ctx.route("/scaffold", (req, res) => {
    const { template = "minimal-kmod", moduleName = "anyrealm_mod", kdir = "/lib/modules/$(uname -r)/build" } = req.body ?? {};
    const mod = String(moduleName).replace(/[^A-Za-z0-9_]/g, "_") || "anyrealm_mod";

    const makefile = `# Build against the TARGET kernel tree, never the host's.
#   make KDIR=/path/to/6.12_android-x86
# Passing KDIR explicitly is the difference between a module that loads and one
# that dies with "invalid module format".
obj-m += ${mod}.o
KDIR ?= ${kdir}
PWD := $(shell pwd)
ARCH ?= x86_64

all:
\t$(MAKE) -C $(KDIR) M=$(PWD) ARCH=$(ARCH) modules
clean:
\t$(MAKE) -C $(KDIR) M=$(PWD) ARCH=$(ARCH) clean
`;

    const bodies = {
      "minimal-kmod": `// Minimal LKM: load, log, unload. Nothing hooked, nothing global.
#include <linux/module.h>
#include <linux/kernel.h>

static int __init ${mod}_init(void)
{
\tpr_info("${mod}: loaded on %s\\n", utsname()->release);
\treturn 0;
}

static void __exit ${mod}_exit(void)
{
\tpr_info("${mod}: unloaded\\n");
}

module_init(${mod}_init);
module_exit(${mod}_exit);
MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("AnyRealm minimal module");
`,
      "kprobe-observable": `// Observable hook: fires when do_sys_openat2 is called, prints the filename.
// Observes only. A kprobe cannot change behaviour, which is why it is the safe
// first module: a bug here can crash the box, but cannot silently corrupt a
// syscall's return value.
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/kprobes.h>
#include <linux/ptrace.h>

static int handler_pre(struct kprobe *p, struct pt_regs *regs)
{
\tpr_info("${mod}: syscall observed\\n");
\treturn 0;
}

static struct kprobe kp = {
\t.symbol_name = "do_sys_openat2",
\t.pre_handler = handler_pre,
};

static int __init ${mod}_init(void)
{
\tint ret = register_kprobe(&kp);
\tif (ret < 0) {
\t\tpr_err("${mod}: register_kprobe failed: %d\\n", ret);
\t\treturn ret;
\t}
\tpr_info("${mod}: probing %s\\n", kp.symbol_name);
\treturn 0;
}

static void __exit ${mod}_exit(void)
{
\tunregister_kprobe(&kp);
}

module_init(${mod}_init);
module_exit(${mod}_exit);
MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("AnyRealm kprobe observer");
`,
      "sysfs-knob": `// A module that exposes one integer under /sys/kernel/${mod}/value.
// The smallest useful shape for a tunable driver: no ioctl, no device node.
#include <linux/module.h>
#include <linux/kobject.h>
#include <linux/sysfs.h>
#include <linux/init.h>

static int value = 1;
static struct kobject *kobj;

static ssize_t value_show(struct kobject *k, struct kobj_attribute *a, char *buf)
{
\treturn sysfs_emit(buf, "%d\\n", value);
}
static ssize_t value_store(struct kobject *k, struct kobj_attribute *a,
\t\t\t   const char *buf, size_t count)
{
\tint v;
\tif (kstrtoint(buf, 10, &v))
\t\treturn -EINVAL;
\tvalue = v;
\treturn count;
}
static struct kobj_attribute value_attr = __ATTR(value, 0644, value_show, value_store);

static int __init ${mod}_init(void)
{
\tkobj = kobject_create_and_add("${mod}", kernel_kobj);
\tif (!kobj) return -ENOMEM;
\tif (sysfs_create_file(kobj, &value_attr.attr)) {
\t\tkobject_put(kobj);
\t\treturn -EIO;
\t}
\treturn 0;
}

static void __exit ${mod}_exit(void)
{
\tkobject_put(kobj);
}

module_init(${mod}_init);
module_exit(${mod}_exit);
MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("AnyRealm sysfs knob");
`,
    };

    const body = bodies[template];
    if (!body) return res.status(400).json({ error: `unknown template "${template}"`, available: Object.keys(bodies) });

    res.json({
      ok: true,
      template,
      moduleName: mod,
      files: [
        { path: `${mod}.c`, contents: body },
        { path: "Makefile", contents: makefile },
        {
          path: "README.md",
          contents: `# ${mod}

Build:

\`\`\`sh
make KDIR=/path/to/target/kernel/tree
modinfo ${mod}.ko        # check vermagic against the target kernel
\`\`\`

Load only on a kernel whose vermagic matches. Check with:

\`\`\`sh
modinfo ${mod}.ko | grep vermagic
cat /proc/version
\`\`\`
`,
        },
      ],
    });
  });
}

/** Feed the Module Lab's build into a composed workflow. */
export function workflowSnippet(body) {
  const mod = String(body?.moduleName ?? "anyrealm_mod").replace(/[^A-Za-z0-9_]/g, "_");
  return [
    `      - name: Build module ${mod}`,
    `        run: |`,
    `          set -euo pipefail`,
    `          make -C "$KERNEL_TREE" M="$PWD/modules/${mod}" modules`,
    `          modinfo "modules/${mod}/${mod}.ko" | grep -E 'vermagic|license'`,
  ].join("\n");
}

export const exports = {
  inspect: "/inspect",
  scaffold: "/scaffold",
  catalog: "/catalog",
};
