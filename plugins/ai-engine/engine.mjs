/**
 * The AI engine behind the terminal.
 *
 * It has two layers, and being clear about which one answered is the whole
 * design:
 *
 *   LOCAL   A real, deterministic engine. It matches error signatures against a
 *           knowledge base of the failures this project actually produces —
 *           vermagic mismatch, deflated bootanimation.zip, KF5 vs KF6, missing
 *           firmware, `|| true` hiding a failure — and returns a diagnosis with
 *           the command to check it. It needs no network and no key, and it never
 *           invents a fact: when it does not recognise something, it says so.
 *
 *   MODEL   An optional language model, used only when a provider is configured.
 *           It gets the same terminal context and is asked to answer as an
 *           assistant that knows this project. It is better at loose questions
 *           ("why is my build slow") and worse at being verifiable.
 *
 * The reason for the split: an assistant that is the only thing that can answer
 * must be honest about its confidence. A local answer that says "this looks like
 * a vermagic mismatch because X" is more useful than a fluent paragraph that
 * might be wrong. So the local engine runs first, and a recognised signature
 * wins. The model is for everything else.
 *
 * Nothing here pretends to be "as good as" a frontier model. It is a domain
 * expert with a small, accurate knowledge base, plus a door to a real model.
 */

import fs from "fs";
import path from "path";

/* ------------------------------------------------------------------ */
/* Knowledge                                                           */
/* ------------------------------------------------------------------ */

/**
 * Each entry is a failure this project has actually produced, with the test
 * that confirms it. `match` is a list of regexes; the score is how many hit,
 * so a single generic word cannot win.
 */
const KNOWLEDGE = [
  {
    id: "vermagic",
    title: "Module vermagic does not match the running kernel",
    match: [/vermagic/i, /version magic/i, /disagrees about version/i, /invalid module format/i, /no symbol version for/i],
    means:
      "The .ko was built against a different kernel than the one loading it. Every module carries the exact kernel version " +
      "plus config flags; load refuses before running any of its code.",
    check: "modinfo ./x.ko | grep vermagic; uname -r; zcat /proc/config.gz 2>/dev/null | grep -E 'CONFIG_LOCALVERSION|CONFIG_MODVERSIONS'",
    fix:
      "Rebuild against the tree that produced the running kernel, not a nearby one. `uname -r` is the truth; a tree at " +
      "the same version but a different LOCALVERSION is a different kernel.",
    seen:
      "This project hit it when the ISO shipped one `6.12.0-g7042991a5c9d-dirty` tree and a module built elsewhere.",
  },
  {
    id: "bootanimation-stored",
    title: "bootanimation.zip was deflated",
    match: [/bootanimation/i, /black screen.*boot/i, /boot.*black screen/i, /desc\.txt/i],
    means:
      "Android's boot animation player mmaps entries out of the zip. A deflated entry cannot be mmapped, so it plays " +
      "nothing and the screen stays black for the whole animation window.",
    check: "unzip -v bootanimation.zip | head -20   # look at the 'Method' column; it must say Stored",
    fix:
      "Rebuild the zip with stored entries (`zip -0 -r`), and write desc.txt with LF endings only — CRLF breaks the parser.",
    seen: "The splash generator here writes stored entries for exactly this reason.",
  },
  {
    id: "kf-version",
    title: "Qt5/KF5 vs Qt6/KF6 mismatch",
    match: [/KFG?[56]/i, /could not find a package configuration file.*KF/i, /Qt5.*Qt6/i, /kio-fuse/i, /ECM.*not found/i],
    means:
      "kio-fuse and most KDE components exist on two incompatible source lines. Building the 6.x tree against KF5 headers " +
      "fails at find_package(KF6); building 5.x against KF6 headers can link and then break at runtime.",
    check: "dpkg -l 'libkf[56]*-dev' | awk '/^ii/{print $2}'; pacman -Q kio kcoreaddons 2>/dev/null",
    fix:
      "Pick the line that matches the installed KDE, and install that line's dependency set — not the union of both.",
    seen: "The KIO-FUSE pipeline plugin exists to make this choice explicit.",
  },
  {
    id: "silent-failure",
    title: "A step failed and the script carried on",
    match: [/\|\| true/, /failed but/i, /exit 0/, /no error.*but.*empty/i],
    means:
      "`|| true` turns a failure into a success. Three builds in this project reported success while shipping an image " +
      "with no modules, because the firmware step was inside a branch that never ran and its failure was swallowed.",
    check:
      "set -o pipefail; and check the artifact, not the log: count the files you expected in the image.",
    fix:
      "Remove `|| true` from anything whose absence makes the artifact unusable, and assert on the output — a file count, " +
      "a version string, a required binary — before declaring success.",
    seen: "This is the single most expensive bug in this project's history.",
  },
  {
    id: "firmware-missing",
    title: "Firmware not in the image",
    match: [/firmware/i, /rtw88/i, /amdgpu.*fail/i, /failed to load.*bin/i, /direct firmware load/i, /no such file.*firmware/i],
    means:
      "The module is present but the firmware blob it loads at runtime is not, so the device works only after the binary " +
      "is added. Kernel modules and firmware are separate packages and separate image paths.",
    check:
      "ls /system/lib/firmware | wc -l; find /system/lib/firmware -name 'rtw8821c_fw.bin'; dmesg | grep -i 'direct firmware load'",
    fix:
      "Install firmware-nonfree into the rootfs with --firmware, and verify by counting trees in the image, not by reading " +
      "the build log.",
    seen: "The ISO's firmware block was nested inside an `if [ -n \"$EXTRA_PKGS\" ]` branch that never ran.",
  },
  {
    id: "module-builtin",
    title: "A 'missing' module is compiled in",
    match: [/no such module/i, /module.*not found/i, /kvm\.ko/i, /kvm/i, /modprobe.*not found/i],
    means:
      "Not every driver exists as a .ko. If it is built into the kernel, there is no module file and modprobe succeeds " +
      "by doing nothing.",
    check: "zgrep -E 'CONFIG_KVM=' /proc/config.gz; grep -c 'kvm.ko' /lib/modules/$(uname -r)/modules.builtin",
    fix:
      "Check modules.builtin before concluding a module is missing. `=y` is built in, `=m` is a module, unset is neither.",
    seen: "The ISO shipping no kvm.ko is correct: KVM is `=y`.",
  },
  {
    id: "esm",
    title: "require() in an ES module",
    match: [/require is not defined/i, /ES module scope/i, /__dirname is not defined/i, /ERR_REQUIRE_ESM/i],
    means:
      "The file is an ES module, so `require`, `__dirname` and `module.exports` do not exist. Node 26 rejects it at import " +
      "time, which kills the process before it opens a port — so the symptom looks like 'the server will not start'.",
    check: "grep -n 'package.json' -e '\"type\"'; grep -rn 'require(' --include=*.ts .",
    fix: "Use `import os from \"os\"` and `fileURLToPath(import.meta.url)` instead.",
    seen: "This broke the builder's own server start.",
  },
  {
    id: "plugin-html",
    title: "A plugin endpoint returns HTML",
    match: [/unexpected token.*</i, /JSON\.parse/i, /plugin.*not working/i, /404.*plugin/i, /doctype/i],
    means:
      "The dev server's SPA fallback answered before the plugin's route. The plugin reports healthy and returns 200, but " +
      "every endpoint hands back index.html, so the panel looks alive and does nothing.",
    check: "curl -s /api/plugins/<id>/catalog | head -c 60",
    fix: "Mount plugins before the Vite/static middleware. Order matters and the failure is silent.",
    seen: "Found in this project: three plugins were mounted after the SPA fallback.",
  },
  {
    id: "out-of-space",
    title: "Ran out of disk",
    match: [/no space left/i, /ENOSPC/i, /disk full/i, /cannot write.*no space/i],
    means:
      "Either the build tree or the output filled the volume. A kernel tree plus modules is several GB, and the workspace " +
      "is separate from where the image is assembled.",
    check: "df -h; du -sh <builddir> 2>/dev/null; ls -la /mnt",
    fix:
      "Build on the volume with room (/mnt), not the root filesystem, and delete the intermediate tree — it is rebuildable " +
      "and usually the largest thing present.",
    seen: "The workspace root reached 84% during this work.",
  },
  {
    id: "ssh-timeout",
    title: "A remote build host hangs or refuses",
    match: [/connection timed out/i, /connection refused/i, /permission denied \(publickey/i, /host key verification/i, /ssh/i],
    means:
      "The address, the key, or the host being down. `BatchMode=yes` matters: without it a key prompt blocks until the " +
      "socket timeout, which reads as a broken server rather than an unauthorised key.",
    check: "ssh -o BatchMode=yes -o ConnectTimeout=8 user@host 'hostname; nproc'",
    fix:
      "Probe the address before dispatching, and keep more than one endpoint per remote — which of LAN, public or tunnel " +
      "works changes with the network you are on.",
    seen: "The Compile Router probes the whole endpoint pool for this reason.",
  },
  {
    id: "partition-brick",
    title: "Writing a signed/opaque partition",
    match: [/xbl|abl|tz|hyp|modem|keymaster|persist|modemst|vbmeta/i, /firehose/i, /EDL/i],
    means:
      "Those partitions are signed or hold per-device data. Their contents are not meant to be edited, and a wrong write " +
      "bricks the device — sometimes permanently, because the boot chain no longer verifies.",
    check: "Do not edit them. Read and compare hashes instead.",
    fix:
      "Keep them original. Unpack/repack is offered for the editable partitions only; for these, the option is absent rather " +
      "than discouraged.",
    seen: "The partition catalog marks them keep-original.",
  },
];

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** Score every entry against the text. Highest score wins; ties are reported. */
function diagnose(text) {
  const haystack = String(text ?? "");
  const scored = KNOWLEDGE.map((k) => {
    let hits = 0;
    const matched = [];
    for (const re of k.match) {
      if (re.test(haystack)) {
        hits++;
        matched.push(re.source);
      }
    }
    return { entry: k, hits, matched };
  })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  return scored;
}

/** Pull the most plausible error lines out of a log, so the answer quotes real text. */
function errorLines(text, max = 6) {
  const lines = String(text ?? "").split(/\r?\n/);
  const hits = [];
  for (const line of lines) {
    if (/\b(error|fatal|cannot|failed|denied|not found|no such file|undefined|refused|timeout)\b/i.test(line)) {
      const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
      if (clean.length > 4 && clean.length < 400) hits.push(clean);
    }
  }
  // Last ones first: a build's real failure is usually near the end, not the first warning.
  return hits.slice(-max);
}

/* ------------------------------------------------------------------ */
/* Provider (optional)                                                 */
/* ------------------------------------------------------------------ */

/**
 * The provider is configured by environment, never hardcoded, so the same build
 * runs with or without one.
 *
 *   ANYREALM_AI_BASE   OpenAI-compatible base URL, e.g. https://api.example/v1
 *   ANYREALM_AI_KEY    bearer token
 *   ANYREALM_AI_MODEL  model id
 *
 * OpenAI's shape is used because it is the one most providers and gateways
 * speak; a vendor-specific SDK would pin the project to one of them.
 */
/**
 * Resolve which model, if any, will answer.
 *
 * Precedence, most specific first:
 *
 *   1. An API provider the user activated (OpenRouter, Anthropic, a gateway).
 *      It was chosen explicitly, and it costs money per call — so it is not
 *      quietly overridden by something else.
 *   2. The VM tunnel. An activated API provider beats it because activating one
 *      is a deliberate act; a tunnel merely being open is a state.
 *   3. Environment variables, for a deployment wired by its operator.
 *
 * Each branch reports a different `source`, because "the assistant is not
 * answering" has a different fix for each and a single "configured: false"
 * would hide which one to check.
 */
export function providerStatus(runtime) {
  const api = runtime?.getApiProvider?.() ?? null;
  if (api?.base && api?.key && api?.model) {
    return {
      configured: true,
      source: api.source ?? "api",
      model: api.model,
      base: String(api.base).replace(/\/\/[^/]+/, "//<host>"),
      howTo: null,
    };
  }

  const rt = runtime?.getProviderBase?.() ? runtime : null;
  const base = rt ? rt.getProviderBase() : process.env.ANYREALM_AI_BASE;
  const model = rt ? rt.getModelName?.() ?? "local-gguf" : process.env.ANYREALM_AI_MODEL;
  // A tunnelled local server has no authentication; a remote one needs a key.
  const key = rt ? "local" : process.env.ANYREALM_AI_KEY;
  return {
    configured: !!(base && model && key),
    /** Where it came from, so "why is it not using my key" has an answer. */
    source: rt ? "vm-tunnel" : base ? "environment" : null,
    model: model ?? null,
    base: base ? base.replace(/\/\/[^/]+/, "//<host>") : null,
    /** Both ways of enabling it, since either is valid. */
    howTo:
      base && model && key
        ? null
        : "connect a model VM in Settings, or add an API key under Model providers",
  };
}

const SYSTEM_PROMPT = `You are the assistant inside AnyRealm, a tool that builds a fused Linux+Android install
image and flashable Android kernels. You answer questions in a terminal, so be brief and concrete.

Rules that matter:
- Prefer a command the user can run over a paragraph of explanation.
- Never invent a config symbol, a file path or a command flag. If unsure, say what to check.
- A kernel module and its firmware are different files in different places; do not conflate them.
- Signed partitions (xbl, abl, tz, hyp, modem, keymaster, persist, modemst, vbmeta) are read-only; never suggest editing them.
- If the user's output shows a failure your knowledge covers, name the failure and the test that confirms it.
- When asked to compare yourself to a larger model, be honest: you are a focused assistant, not a frontier model.`;

async function askProvider(question, context, history, runtime) {
  const api = runtime?.getApiProvider?.() ?? null;
  const rt = runtime?.getProviderBase?.() ? runtime : null;
  const { base, key, model } = api?.base && api?.key && api?.model
    ? { base: api.base, key: api.key, model: api.model }
    : {
        base: rt ? rt.getProviderBase() : process.env.ANYREALM_AI_BASE,
        key: rt ? "local" : process.env.ANYREALM_AI_KEY,
        model: rt ? rt.getModelName?.() ?? "local-gguf" : process.env.ANYREALM_AI_MODEL,
      };
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history ?? []).slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content) })),
    {
      role: "user",
      content: context ? `${question}\n\n--- terminal output ---\n${String(context).slice(-6000)}` : question,
    },
  ];

  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 500 }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // The status matters: 401 is a key problem, 429 is quota, 404 is a wrong
    // base URL or model name. Reporting "AI failed" hides which.
    throw new Error(`provider returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("provider returned no message content");
  return text;
}

/* ------------------------------------------------------------------ */

/**
 * Mount the assistant under a prefix so a host plugin (the terminal) owns it as
 * one panel rather than making the user leave the shell to ask a question.
 *
 * `mount(ctx, "/ai")` puts /status, /ask, /history and /provider/test under
 * /ai/... on the caller's plugin base.
 */
export async function mount(ctx, prefix = "", runtime = null) {
  const p = (sub) => (prefix ? `${prefix}${sub}` : sub);
  const workDir = ctx.workDir();
  const historyPath = path.join(workDir, "assistant-history.json");

  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(historyPath, "utf8")).history ?? [];
  } catch {
    history = [];
  }

  const saveHistory = () => {
    // Bounded: a conversation that grows forever is a file that grows forever.
    history = history.slice(-60);
    fs.writeFileSync(historyPath, JSON.stringify({ history }, null, 2));
  };

  ctx.route(p("/status"), (_req, res) => {
    res.json({
      provider: providerStatus(runtime),
      knowledge: KNOWLEDGE.map((k) => ({ id: k.id, title: k.title })),
      turns: history.length,
    });
  });

  ctx.route(p("/ask"), async (req, res) => {
    const { question, context, useModel } = req.body ?? {};
    const q = String(question ?? "").trim();
    if (!q) return res.status(400).json({ error: "question is required" });

    const status = providerStatus(runtime);
    const wantsModel = useModel !== false && status.configured;

    // The local engine runs first and can answer alone. This is not a fallback:
    // for a recognised signature it is the better answer, because it is a fact
    // with a test rather than a plausible paragraph.
    const scored = diagnose(`${q}\n${context ?? ""}`);
    const top = scored[0];

    const local = top
      ? {
          kind: "diagnosis",
          id: top.entry.id,
          title: top.entry.title,
          confidence: top.hits >= 2 ? "high" : "medium",
          // Say how it decided, so the user can disagree with the reasoning.
          because: `${top.hits} matching signature(s)${top.matched.length ? `: ${top.matched.slice(0, 3).join(", ")}` : ""}`,
          means: top.entry.means,
          check: top.entry.check,
          fix: top.entry.fix,
          seen: top.entry.seen,
          others: scored.slice(1, 3).map((s) => ({ id: s.entry.id, title: s.entry.title, hits: s.hits })),
        }
      : null;

    const evidence = errorLines(context);

    // A confident local diagnosis answers the question. A loose one, or no match
    // at all, is where a model is actually better.
    const needsModel = wantsModel && (!local || local.confidence === "medium");

    let model = null;
    let modelError = null;
    if (needsModel) {
      try {
        const answer = await askProvider(q, context, history.slice(-8), runtime);
        model = { answer };
      } catch (e) {
        // The local answer is still returned. A provider failure must not turn a
        // working assistant into an error page.
        modelError = e.message;
      }
    }

    history.push({ role: "user", content: q, at: new Date().toISOString() });
    if (model) history.push({ role: "assistant", content: model.answer, at: new Date().toISOString() });
    else if (local) {
      history.push({ role: "assistant", content: `${local.title}: ${local.fix}`, at: new Date().toISOString() });
    }
    saveHistory();

    res.json({
      question: q,
      local,
      model,
      modelError,
      provider: status,
      /**
       * When nothing matched and no model is configured, say so plainly rather
       * than producing a confident-sounding guess. An assistant that admits it
       * does not know is usable; one that bluffs is not.
       */
      unmatched: !local && !model,
      evidence,
      followUp: !local && !status.configured
        ? [
            "no local signature matched, and no model provider is configured",
            `paste the exact error line, or enable a provider (${status.howTo})`,
          ]
        : null,
    });
  });

  /** Clear the conversation. */
  ctx.route(p("/history"), (req, res) => {
    if (req.method === "DELETE") {
      history = [];
      saveHistory();
      return res.json({ ok: true, turns: 0 });
    }
    res.json({ history: history.map((m) => ({ role: m.role, content: m.content, at: m.at })) });
  });

  /**
   * Test the provider without spending a real question's context: a one-word
   * prompt. This is how "is my key working" gets answered instead of guessed.
   */
  ctx.route(p("/provider/test"), async (_req, res) => {
    const status = providerStatus(runtime);
    if (!status.configured) {
      return res.status(400).json({ error: "no provider configured", howTo: status.howTo });
    }
    const started = Date.now();
    try {
      const answer = await askProvider("Reply with the single word: ready", null, [], runtime);
      res.json({ ok: true, latencyMs: Date.now() - started, answer: String(answer).slice(0, 200), model: status.model });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message, model: status.model });
    }
  });

  ctx.log(
    `local knowledge: ${KNOWLEDGE.length} signatures; provider: ${providerStatus(runtime).source ?? "not configured"}`,
  );
}
