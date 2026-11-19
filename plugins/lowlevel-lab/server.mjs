/**
 * Low-Level Research Lab: EDL, EUD, QDL, Hexagon.
 *
 * These four are the transports that exist below fastboot, and they are routinely
 * confused with each other. The distinction that matters operationally:
 *
 *   EDL    Qualcomm emergency download mode. The SoC enumerates as USB
 *          05c6:9008. The host sends a *programmer* (a signed firehose binary)
 *          which then speaks the Sahara and Firehose protocols. Writes go
 *          through Firehose's `program` command with a physical-partition
 *          number, not a partition name — getting the LUN/number wrong writes a
 *          partition image over the GPT.
 *
 *   EUD    Emergency USB Download. Qualcomm's newer recovery path (and Apple's
 *          equivalent, also called EUD). No firehose; a different, largely
 *          undocumented protocol. Devices that expose EUD usually also expose
 *          EDL, and when both do, EDL is the documented one.
 *
 *   QDL    Not a mode. It is the *host tool* from Linaro/CodeAurora that speaks
 *          Sahara + Firehose. So "use QDL" means "use this client to talk to an
 *          EDL device". Treating QDL as a device mode is a category error that
 *          makes people look for a USB id that does not exist.
 *
 *   Hexagon  Qualcomm's DSP architecture. `hexagon` here is not a transport at
 *          all: it is a set of image formats (the DSP firmware in `dsp`/`adsp`
 *          partitions, and `.mbn` files inside them) and a toolchain
 *          (`hexagon-clang`, `llvm-mc` with the hexagon target). Nothing is
 *          flashed over a hexagon transport.
 *
 * Everything in this lab is read-mostly. Writing through EDL is the single most
 * destructive operation the builder can offer, so the write paths are described
 * and gated rather than exposed as one button.
 */

import fs from "fs";
import { readRegistry, writeRegistry, checkFork, remoteRecipe } from "./forks.mjs";

const USB_IDS = [
  { id: "05c6:9008", name: "Qualcomm EDL (Sahara/Firehose)", note: "the classic emergency download id" },
  { id: "05c6:900e", name: "Qualcomm EDL, alternate", note: "seen on some newer SoCs" },
  { id: "05c6:901d", name: "Qualcomm diagnostic/DIAG", note: "not EDL; a diag port" },
  { id: "05c6:9091", name: "Qualcomm EUD", note: "emergency USB download, not firehose" },
  { id: "18d1:4ee0", name: "Google fastboot", note: "not low-level; included so the contrast is visible" },
];

const PROGRAMMERS = [
  { soc: "sm6450 (yume/genevn)", file: "prog_firehose_ddr.elf", note: "must match the SoC; a programmer from another SoC fails Sahara handshake" },
  { soc: "sm8250", file: "prog_firehose_ddr.elf", note: "same filename, different binary — never interchangeable" },
  { soc: "msm8998", file: "prog_firehose_ddr.elf", note: "" },
];

const FIREHOSE_CAUTION = [
  "Firehose `program` takes a physical-partition number, not a name. The numbers come from the device's GPT, and a stale GPT means every number after the mismatch is wrong.",
  "Always run `getstorageinfo` first and confirm the partition table it reports matches the dump you are writing.",
  "`erase` on the wrong LUN destroys the GPT and the device will not enumerate as EDL again without a test point.",
  "A sparse image must be sent with the sparse-aware `program` form; sending a sparse file as raw writes sparse headers into the partition.",
];

export async function register(ctx) {
  // ---- fork registry -----------------------------------------------------
  // A fork is only worth having if it still tracks upstream and has commits of
  // its own. These routes report those facts instead of assuming them. Nothing
  // here clones: a read-only `git ls-remote` answers "is it reachable".

  ctx.route("/forks", (_req, res) => {
    res.json({ forks: readRegistry(ctx.workDir()) });
  });

  ctx.route("/forks/save", (req, res) => {
    const body = req.body ?? {};
    if (!body.id) return res.status(400).json({ error: "id is required" });
    const forks = readRegistry(ctx.workDir());
    const i = forks.findIndex((f) => f.id === body.id);
    if (i < 0) return res.status(404).json({ error: `no fork entry "${body.id}"` });
    // id and transport are identity: a save must not rename the entry it edits.
    forks[i] = { ...forks[i], ...body, id: forks[i].id, transport: forks[i].transport };
    writeRegistry(ctx.workDir(), forks);
    res.json({ ok: true, forks });
  });

  ctx.route("/forks/check", async (req, res) => {
    const { id } = req.body ?? {};
    const forks = readRegistry(ctx.workDir());
    const targets = id ? forks.filter((f) => f.id === id) : forks;
    if (targets.length === 0) return res.status(404).json({ error: `no fork entry "${id}"` });
    try {
      const results = [];
      for (const f of targets) results.push(await checkFork(f));
      res.json({ results });
    } catch (e) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  ctx.route("/forks/recipe", (req, res) => {
    const { id } = req.body ?? {};
    const forks = readRegistry(ctx.workDir());
    const f = forks.find((x) => x.id === id);
    if (!f) return res.status(404).json({ error: `no fork entry "${id}"` });
    res.json({ id, lines: remoteRecipe(f) });
  });

  ctx.route("/catalog", (_req, res) => {
    res.json({
      transports: [
        {
          id: "edl",
          mode: "device mode",
          name: "EDL — Emergency Download",
          usb: ["05c6:9008", "05c6:900e"],
          protocol: ["Sahara (programmer upload)", "Firehose (read/write/erase)"],
          hostTools: [
            { name: "qdl", pkg: "qdl (Linaro)", speaks: "Sahara + Firehose", config: "XML <nand>/<program>/<erase> lists" },
            { name: "edl.py", pkg: "bkerler/edl", speaks: "Sahara + Firehose + more loaders", config: "CLI, supports many vendor programmers" },
            { name: "QFIL / QFIL2", pkg: "vendor Windows tool", speaks: "Firehose", config: "proprietary" },
          ],
          writes: "yes — this is the destructive one",
          requirements: ["a firehose programmer matching the SoC", "the device's GPT (or a full rawprogram XML)"],
          cautions: FIREHOSE_CAUTION,
        },
        {
          id: "eud",
          mode: "device mode",
          name: "EUD — Emergency USB Download",
          usb: ["05c6:9091"],
          protocol: ["undocumented; not Sahara, not Firehose"],
          hostTools: [{ name: "vendor tooling only", pkg: "—", speaks: "EUD", config: "—" }],
          writes: "vendor tooling only",
          requirements: ["the vendor's own EUD tool; there is no open implementation"],
          cautions: [
            "If a device exposes both EUD and EDL, use EDL: it is documented and the open tools work.",
            "There is no libqdl path for EUD. Any guide that says otherwise is wrong.",
          ],
        },
        {
          id: "qdl",
          mode: "HOST TOOL (not a device mode)",
          name: "QDL — Qualcomm Download client",
          usb: [],
          protocol: ["implements Sahara and Firehose as the *host* side"],
          hostTools: [{ name: "qdl", pkg: "qdl", speaks: "Sahara + Firehose", config: "rawprogram XML" }],
          writes: "yes — through an EDL device",
          requirements: ["a device already in EDL", "a programmer", "a rawprogram/patch XML set"],
          cautions: [
            "QDL is the client. There is no 'qdl mode' USB id to wait for.",
            "This is the point people get stuck: they look for a QDL device and there is no such thing.",
          ],
        },
        {
          id: "hexagon",
          mode: "IMAGE FORMAT + TOOLCHAIN (not a transport)",
          name: "Hexagon — Qualcomm DSP",
          usb: [],
          protocol: ["none; this is a CPU architecture"],
          hostTools: [
            { name: "hexagon-clang / hexagon-llvm", pkg: "Hexagon SDK or LLVM with the hexagon target", speaks: "—", config: "—" },
            { name: "pil-squasher / pil-splitter", pkg: "msm-firmware-loader", speaks: "—", config: "splits adsp/dsp firmware into per-PD .mbn files" },
          ],
          writes: "no — images end up inside dsp/adsp/modem partitions, flashed by other means",
          requirements: ["the DSP firmware set for the SoC", "an ELF/MBN aware tool if you want to look inside"],
          cautions: [
            "`.mbn` is a signed ELF variant. You can read the ELF headers; you cannot usefully modify the code and have it load.",
            "Hexagon has nothing to do with EDL. A 'hexagon edl' guide is mixing two unrelated things.",
          ],
        },
      ],
      usbIds: USB_IDS,
      programmers: PROGRAMMERS,
      imageFormats: [
        { ext: ".mbn", what: "signed Qualcomm ELF firmware (modem, adsp, cdsp, wlan)", inspect: ["readelf", "-h"], repack: "keep-original" },
        { ext: ".elf", what: "firehose programmer or DSP ELF", inspect: ["readelf", "-h", "{in}"], repack: "keep-original" },
        { ext: ".xml", what: "rawprogram / patch list for Firehose", inspect: ["head", "-40", "{in}"], repack: "edit by hand" },
        { ext: ".b00 / .mbn chunk", what: "Sahara/MBN chunk, sometimes split", inspect: ["file", "{in}"], repack: "concatenate in order" },
      ],
      // The one command that is safe to run anywhere: see what is plugged in.
      probe: "lsusb | grep -E '05c6:|18d1:'",
    });
  });

  /** Report which low-level tools exist, and what each unlocks. */
  ctx.route("/tools", (_req, res) => {
    const want = ["qdl", "edl", "lsusb", "readelf", "objdump", "python3", "hexagon-clang", "llvm-mc"];
    const tools = want.map((t) => {
      const p = ctx.which(t);
      return {
        tool: t,
        path: p,
        unlocks: UNLOCKS[t] ?? [],
      };
    });
    res.json({
      tools,
      missing: tools.filter((t) => !t.path).map((t) => ({ tool: t.tool, unlocks: t.unlocks })),
      note: "readelf and objdump are enough to inspect any .mbn; nothing here needs qdl unless you intend to write.",
    });
  });

  /**
   * Given a device dump or a partition name, say how it would be reached at the
   * lowest level. This is the question the lab exists to answer without anyone
   * having to remember which mode does what.
   */
  ctx.route("/route", (req, res) => {
    const { partition, fileName } = req.body ?? {};
    const name = String(partition ?? fileName ?? "").toLowerCase();

    const routes = [];
    if (/^(xbl|abl|tz|hyp|aop|devcfg|keymaster|qupfw|shrm|cpucp|xbl_config|xbl_ramdump|uefi|uefisecapp|uefivarstore|storsec|spunvm|qmcs|connsec|ssd|ddr)/.test(name)) {
      routes.push({
        transport: "edl",
        why: "bootloader-stage firmware; on a device that will not boot this is the only way in",
        tool: "qdl or edl.py with a firehose programmer for the SoC",
        risk: "high — wrong physical partition number overwrites the GPT",
      });
    }
    if (/^(modem|fsg|fsc|modemst1|modemst2|dsp|adsp|cdsp|bluetooth)/.test(name)) {
      routes.push({
        transport: "edl",
        why: "vendor data or DSP firmware; fastboot cannot write most of these on a locked device",
        tool: "qdl / edl.py",
        risk: "high — device-unique data (IMEI, calibration)",
        also: "dsp/adsp/cdsp contain hexagon .mbn images; read them with readelf, do not patch them",
      });
    }
    if (/^(boot|vendor_boot|init_boot|recovery|dtbo|super|system|vendor|product|vbmeta)/.test(name)) {
      routes.push({
        transport: "fastboot",
        why: "normal flashing path; not a low-level transport",
        tool: "fastboot flash <partition> <img>",
        risk: "medium — vbmeta flags decide whether the image is accepted",
      });
      routes.push({
        transport: "edl",
        why: "only when fastboot is unavailable (locked bootloader, dead bootloader)",
        tool: "qdl / edl.py",
        risk: "high",
      });
    }
    if (/\.mbn$|hexagon/.test(name)) {
      routes.push({
        transport: "hexagon",
        why: "DSP firmware image, not a transport",
        tool: "readelf/objdump to inspect; keep the bytes to restore",
        risk: "modifying it is useless — it is signed",
      });
    }

    if (routes.length === 0) {
      routes.push({
        transport: "unknown",
        why: "no low-level route recognised for this name",
        tool: "—",
        risk: "—",
      });
    }

    res.json({ name, routes });
  });

  /** A firehose XML dry-run: the list of writes, with the ordering checked. */
  ctx.route("/firehose-plan", (req, res) => {
    const { rawprogram = "", gptPartitions = [] } = req.body ?? {};
    if (typeof rawprogram !== "string" || !rawprogram.trim()) {
      return res.status(400).json({ error: "rawprogram XML text is required" });
    }

    // Parse only the fields that matter: filename, label, physical_partition_number.
    const programs = [];
    for (const m of rawprogram.matchAll(/<program\b[^>]*>/g)) {
      const tag = m[0];
      const get = (k) => new RegExp(`${k}="([^"]*)"`).exec(tag)?.[1] ?? null;
      programs.push({
        label: get("label"),
        filename: get("filename"),
        lun: get("physical_partition_number"),
        startSector: get("start_sector"),
        sparse: get("sparse"),
        rawTag: tag,
      });
    }

    const warnings = [];
    const luns = new Set(programs.map((p) => p.lun));
    const named = new Set(programs.map((p) => p.label).filter(Boolean));

    for (const p of programs) {
      if (!p.filename || p.filename === "DISK") continue;
      if (p.startSector === null) {
        warnings.push(`${p.label ?? "(unnamed)"}: no start_sector — Firehose would write at a computed offset that may not match this device`);
      }
    }

    const numeric = [...named].filter((n) => /^\d+$/.test(String(n)));
    if (numeric.length) {
      warnings.push(`${numeric.length} program(s) use a numeric label instead of a name — that is a physical-partition write, not a named one`);
    }

    if (Array.isArray(gptPartitions) && gptPartitions.length) {
      const gpt = new Set(gptPartitions.map(String));
      const unknown = [...named].filter((n) => n && !gpt.has(String(n)) && !/^(gpt|mibib|PrimaryGPT|BackupGPT)/i.test(String(n)));
      if (unknown.length) {
        warnings.push(`${unknown.length} label(s) not present in the supplied GPT: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? "…" : ""}`);
      }
    }

    res.json({
      ok: warnings.length === 0,
      programs: programs.length,
      luns: [...luns].sort(),
      labels: [...named].slice(0, 200),
      writes: programs.filter((p) => p.filename && p.filename !== "DISK").length,
      erases: programs.filter((p) => !p.filename || p.filename === "DISK").length,
      warnings,
      ordering:
        "Firehose executes in file order. A rawprogram XML generated for another firmware build will be in that build's order; " +
        "check that every start_sector still matches this device's GPT before sending it.",
    });
  });
}

const UNLOCKS = {
  qdl: ["talking to an EDL device (Sahara + Firehose)"],
  edl: ["the alternative EDL client, with more vendor programmers"],
  lsusb: ["seeing whether the device is actually in EDL, and on which id"],
  readelf: ["inspecting .mbn / .elf firmware headers without any vendor tool"],
  objdump: ["disassembling or dumping hexagon/modem firmware sections"],
  python3: ["running edl.py, pil-splitter and most firehose helpers"],
  "hexagon-clang": ["building hexagon code (rarely needed; firmware is signed)"],
  "llvm-mc": ["hexagon assembly"],
};

export function workflowSnippet(body) {
  const op = String(body?.operation ?? "probe").replace(/[^a-z0-9-]/gi, "");
  if (op === "probe") {
    return [
      `      - name: Low-level probe (EDL/USB)`,
      `        run: |`,
      `          set -euo pipefail`,
      `          lsusb | grep -E '05c6:(9008|900e|9091)' || echo "no EDL/EUD device attached"`,
    ].join("\n");
  }
  return [
    `      - name: Inspect low-level images`,
    `        run: |`,
    `          set -euo pipefail`,
    `          for f in *.mbn *.elf; do [ -e "$f" ] || continue; echo "== $f"; readelf -h "$f" | head -12; done`,
  ].join("\n");
}

export const exports = { catalog: "/catalog", tools: "/tools", route: "/route", "firehose-plan": "/firehose-plan" };
