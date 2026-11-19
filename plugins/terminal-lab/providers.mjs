/**
 * Model providers that are not a machine: an HTTP API you hold a key for.
 *
 * A GGUF on a VM and an API endpoint are both "a model", but they fail in
 * completely different ways, so they are stored and diagnosed separately:
 *
 *   GGUF      needs a tunnel, a running llama-server, and enough RAM on the box.
 *             Free after setup, slow on a CPU, and private — nothing leaves it.
 *
 *   API       needs a key, a network route, and quota. Fast, costs money per
 *             token, and every question leaves the machine.
 *
 * The assistant does not care which one answers; the settings panel has to,
 * because the fix for "it is not answering" is different in each case.
 *
 * Keys are stored in this plugin's gitignored data directory and are never
 * returned by any endpoint — the UI shows a masked form so a key can be checked
 * without being read back. A key that can be printed by the server is a key that
 * ends up in a screenshot.
 *
 * Note on Cline: it is a client, not an inference provider. It speaks the same
 * OpenAI-compatible protocol as everything here and can use the same OpenRouter
 * key, so it appears as a note rather than a provider — claiming otherwise would
 * send people looking for a Cline API key that does not exist.
 */

import fs from "fs";
import path from "path";

/** Presets. `base` is what the OpenAI-compatible client is pointed at. */
export const PRESETS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    models: [
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5",
      "google/gemini-2.5-pro",
      "qwen/qwen3-coder",
      "deepseek/deepseek-chat-v3.1:free",
    ],
    detail:
      "One key, many models. Good for the questions the local engine cannot answer, and the free tiers cost nothing.",
    needs: "an API key from openrouter.ai/keys",
  },
  {
    id: "anthropic",
    label: "Anthropic (OpenAI-compatible)",
    base: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-5", "claude-opus-4-1"],
    detail: "Direct Anthropic access over the OpenAI-compatible endpoint.",
    needs: "an Anthropic API key",
  },
  {
    id: "openai",
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini"],
    detail: "Direct OpenAI access.",
    needs: "an OpenAI API key",
  },
  {
    id: "groq",
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "qwen/qwen3-32b"],
    detail: "Very fast inference for open models. Useful when a local CPU model is too slow to be pleasant.",
    needs: "a Groq API key",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    detail: "Cheap, strong at code. A good second opinion when the local 7B is not enough.",
    needs: "a DeepSeek API key",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    base: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "codestral-latest", "mistral-small-latest"],
    detail: "European-hosted models; Codestral is aimed at code completion.",
    needs: "a Mistral API key",
  },
  {
    id: "alibaba",
    label: "Alibaba Cloud (DashScope)",
    base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3-coder-plus", "qwen-max", "qwen-plus"],
    detail: "Qwen models directly from Alibaba. The same family as the local GGUF, at API size.",
    needs: "a DashScope API key",
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    base: "",
    models: [],
    detail: "Any endpoint speaking /chat/completions — a gateway, a proxy, or a self-hosted server.",
    needs: "a base URL that includes /v1",
  },
];

export function createProviders(ctx) {
  const workDir = ctx.workDir();
  const statePath = path.join(workDir, "providers.json");

  let state = { list: [], activeId: null, modelPref: null };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(statePath, "utf8")) };
  } catch {
    /* first run */
  }

  const save = () => {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    } catch (e) {
      ctx.log(`could not save providers: ${e.message}`);
    }
  };

  const active = () => state.list.find((p) => p.id === state.activeId) ?? null;

  /** Public view: the key never leaves the server, only its presence. */
  const mask = (p) => ({
    id: p.id,
    preset: p.preset,
    label: p.label,
    base: p.base,
    model: p.model,
    models: p.models ?? [],
    hasKey: !!p.key,
    /** Last few characters only, so a key can be recognised but not reused. */
    keyHint: p.key ? `…${String(p.key).slice(-4)}` : null,
    addedAt: p.addedAt,
    lastTest: p.lastTest ?? null,
  });

  async function ask(base, key, model, prompt, timeoutMs = 60000) {
    const url = `${String(base).replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        // OpenRouter attributes traffic with these; harmless elsewhere.
        "HTTP-Referer": "https://anyrealm.local",
        "X-Title": "AnyRealm builder",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 32,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // The status is the diagnosis: 401 key, 402 credits, 404 model or base,
      // 429 quota. "AI failed" would hide all four.
      const hint =
        res.status === 401
          ? "the key was rejected — check it was copied whole"
          : res.status === 402
            ? "the account has no credits"
            : res.status === 404
              ? "the base URL or model name was not found — the base usually ends in /v1"
              : res.status === 429
                ? "rate limited or out of quota"
                : "";
      throw new Error(`${res.status} ${hint}${text ? `: ${String(text).slice(0, 200)}` : ""}`.trim());
    }
    const data = JSON.parse(text);
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error("the provider returned no message content");
    return { answer, usage: data.usage ?? null };
  }

  return {
    PRESETS,
    state: () => state,
    list: () => state.list.map(mask),
    active,
    activeMasked: () => (active() ? mask(active()) : null),
    save,

    add({ preset, base, model, key, label }) {
      const p = PRESETS.find((x) => x.id === preset);
      if (!p) return { ok: false, error: `unknown preset "${preset}"` };
      const resolvedBase = String(base || p.base || "").trim();
      if (!resolvedBase) return { ok: false, error: "a base URL is required for a custom provider" };
      if (!/^https?:\/\//.test(resolvedBase)) return { ok: false, error: "the base URL must start with http:// or https://" };
      if (!String(model || "").trim()) return { ok: false, error: "a model name is required" };
      if (!String(key || "").trim()) return { ok: false, error: "an API key is required" };

      const entry = {
        id: `pv-${Date.now().toString(36)}`,
        preset: preset,
        label: String(label || p.label).slice(0, 60),
        base: resolvedBase.replace(/\/$/, ""),
        model: String(model).trim(),
        models: p.models ?? [],
        key: String(key).trim(),
        addedAt: Date.now(),
      };
      state.list.push(entry);
      // The first provider added becomes active: an entry that is not used is
      // a key sitting in a file for no reason.
      if (!state.activeId) state.activeId = entry.id;
      save();
      return { ok: true, provider: mask(entry) };
    },

    remove(id) {
      const i = state.list.findIndex((p) => p.id === id);
      if (i < 0) return { ok: false, error: `no provider "${id}"` };
      state.list.splice(i, 1);
      if (state.activeId === id) state.activeId = state.list[0]?.id ?? null;
      save();
      return { ok: true, activeId: state.activeId };
    },

    activate(id) {
      const p = state.list.find((x) => x.id === id);
      if (!p) return { ok: false, error: `no provider "${id}"` };
      state.activeId = id;
      save();
      return { ok: true, provider: mask(p) };
    },

    /** Change the model on an existing provider without re-entering the key. */
    setModel(id, model) {
      const p = state.list.find((x) => x.id === id);
      if (!p) return { ok: false, error: `no provider "${id}"` };
      if (!String(model ?? "").trim()) return { ok: false, error: "model name is required" };
      p.model = String(model).trim();
      save();
      return { ok: true, provider: mask(p) };
    },

    /** Spend a few tokens to prove the key, model and base actually work. */
    async test(id) {
      const p = id ? state.list.find((x) => x.id === id) : active();
      if (!p) return { ok: false, error: "no provider to test" };
      const started = Date.now();
      try {
        const r = await ask(p.base, p.key, p.model, "Reply with the single word: ready", 45000);
        p.lastTest = { ok: true, at: Date.now(), latencyMs: Date.now() - started, answer: String(r.answer).slice(0, 120) };
        save();
        return { ok: true, latencyMs: p.lastTest.latencyMs, answer: p.lastTest.answer, model: p.model };
      } catch (e) {
        p.lastTest = { ok: false, at: Date.now(), latencyMs: Date.now() - started, error: e.message };
        save();
        return { ok: false, error: e.message };
      }
    },

    /** What the assistant uses, if a provider is active. */
    runtime() {
      const p = active();
      if (!p) return null;
      return { base: p.base, key: p.key, model: p.model, source: `api:${p.preset}` };
    },
  };
}
