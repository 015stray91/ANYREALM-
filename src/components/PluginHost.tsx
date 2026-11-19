/**
 * Plugin host.
 *
 * Renders whatever addons the server reports, without the app importing any of
 * them. Each plugin gets its own tab; the tab body is a purpose-built view chosen
 * by the panel's `icon`/`id`, falling back to a generic endpoint-driven view so a
 * new addon is visible before anyone writes UI for it.
 *
 * The two labs are hand-written below because their shapes are genuinely
 * different and a generic form would flatten both. Everything else — including
 * any addon the user drops in later — falls back to `<GenericPluginPanel>`,
 * which reads a plugin's `catalog` endpoint and renders its keys.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  Plus,
  XCircle,
  CheckCircle2,
  Cpu,
  HardDrive,
  FileCode2,
  Copy,
  Download,
  Play,
  GitMerge,
  Wrench,
  Info,
  Workflow,
  Terminal,
  Sparkles,
  Layers,
  Server,
  Network,
  Package,
  Smartphone,
} from 'lucide-react';
import { AssistantPanel, VmSettingsPanel, ConnectRouterPanel } from './TerminalAssistant';

interface PluginPanelDef {
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  endpoint?: string;
}

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  requires: string[];
  panels: PluginPanelDef[];
  category?: string;
  /** "pipeline" plugins render through the generic stage renderer. */
  kind?: 'panel' | 'pipeline';
  healthy: boolean;
  error?: string;
  missing: string[];
  endpointBase: string;
  exports: Record<string, string> | null;
}

interface PluginHostProps {
  /** Which plugin to render. */
  pluginId: string;
}

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

function Banner({ plugin }: { plugin: Plugin }) {
  return (
    <div className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            {plugin.name}
            <span className="text-[10px] font-mono text-slate-500">v{plugin.version}</span>
            {plugin.healthy ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                mounted
              </span>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300">
                not mounted
              </span>
            )}
          </h2>
          <p className="text-[11px] text-slate-400 mt-1 max-w-3xl leading-relaxed">{plugin.description}</p>
        </div>
        <div className="text-[10px]">
          <div className="text-slate-500 mb-1">requires</div>
          <div className="flex flex-wrap gap-1">
            {plugin.requires.map((t) => {
              const missing = plugin.missing.includes(t);
              return (
                <span
                  key={t}
                  className={`font-mono px-1.5 py-0.5 rounded border ${
                    missing
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  }`}
                >
                  {t}
                  {missing ? ' ✗' : ''}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {plugin.error && (
        <div className="mt-3 text-[10px] font-mono text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">
          {plugin.error}
        </div>
      )}
      {plugin.missing.length > 0 && plugin.healthy && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded p-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Missing: {plugin.missing.join(', ')}. The panel loads, but checks that need these will report
            themselves as unavailable rather than guess.
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LKM / KPM Module Lab                                                */
/* ------------------------------------------------------------------ */

interface ModuleCatalog {
  formats: Array<{ id: string; label: string; arch: string; load: string; checks: string[]; notes: string[] }>;
  tools: Array<{ tool: string; path: string | null }>;
  buildTemplates: string[];
}

function ModuleLab({ plugin }: { plugin: Plugin }) {
  const [catalog, setCatalog] = useState<ModuleCatalog | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [vermagic, setVermagic] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [template, setTemplate] = useState('minimal-kmod');
  const [moduleName, setModuleName] = useState('anyrealm_mod');
  const [scaffold, setScaffold] = useState<any>(null);
  const [snippet, setSnippet] = useState<string | null>(null);

  const [origPath, setOrigPath] = useState('');
  const [modPath, setModPath] = useState('');
  const [style, setStyle] = useState<'patch' | 'diff'>('patch');
  const [ctxLines, setCtxLines] = useState(3);
  const [patchResult, setPatchResult] = useState<any>(null);

  const [kernelVersion, setKernelVersion] = useState('');
  const [patchNames, setPatchNames] = useState('0001-anyrealm.patch');
  const [recipe, setRecipe] = useState<any>(null);

  const [configText, setConfigText] = useState('');
  const [lpPayload, setLpPayload] = useState('');
  const [lpVermagic, setLpVermagic] = useState('');
  const [lpData, setLpData] = useState<any>(null);
  const [lpCheck, setLpCheck] = useState<any>(null);
  const [fragment, setFragment] = useState<string | null>(null);

  useEffect(() => {
    api(`${plugin.endpointBase}/catalog`)
      .then(setCatalog)
      .catch((e) => setError(String(e.message ?? e)));
  }, [plugin.endpointBase]);

  const inspect = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const rd = new FileReader();
        rd.onerror = () => reject(rd.error);
        rd.onload = () => {
          const s = String(rd.result ?? '');
          resolve(s.slice(s.indexOf(',') + 1));
        };
        rd.readAsDataURL(file);
      });
      const d = await api(`${plugin.endpointBase}/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, dataBase64: b64, kernelVermagic: vermagic }),
      });
      setReport(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [file, vermagic, plugin.endpointBase]);

  const buildScaffold = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api(`${plugin.endpointBase}/scaffold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, moduleName }),
      });
      setScaffold(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [template, moduleName, plugin.endpointBase]);

  const getSnippet = useCallback(async () => {
    try {
      const d = await api(`${plugin.endpointBase}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleName }),
      });
      setSnippet(d.snippet);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [moduleName, plugin.endpointBase]);

  const buildPatchNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPatchResult(null);
    try {
      const d = await api('/api/patch/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original: origPath, modified: modPath, style, contextLines: ctxLines }),
      });
      setPatchResult(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [origPath, modPath, style, ctxLines]);

  const buildRecipe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api('/api/patch/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleName,
          kernelVersion: kernelVersion || 'unknown',
          patchNames: patchNames.split(/[\s,]+/).filter(Boolean),
        }),
      });
      setRecipe(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [moduleName, kernelVersion, patchNames]);

  useEffect(() => {
    api('/api/livepatch').then(setLpData).catch(() => {});
  }, []);

  const checkLivepatch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api('/api/livepatch/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configText, payloadPath: lpPayload || undefined, kernelVermagic: lpVermagic || undefined }),
      });
      setLpCheck(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [configText, lpPayload, lpVermagic]);

  const loadFragment = useCallback(async () => {
    try {
      const r = await fetch('/api/livepatch/fragment');
      setFragment(await r.text());
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, []);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {catalog && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {catalog.formats.map((f) => (
            <div key={f.id} className="border border-[#1e293b] bg-[#0b1220] rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{f.label}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 font-mono">
                  {f.arch}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                loaded by <span className="font-mono text-slate-300">{f.load}</span>
              </div>
              <ul className="mt-2 space-y-0.5">
                {f.checks.map((c, i) => (
                  <li key={i} className="text-[10px] text-slate-400 flex items-start gap-1">
                    <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-emerald-500/70" /> {c}
                  </li>
                ))}
              </ul>
              {f.notes.map((n, i) => (
                <div key={i} className="mt-1.5 text-[10px] text-amber-300/90 flex items-start gap-1">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" /> {n}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
          <Cpu className="w-4 h-4 text-emerald-400" /> Inspect a module
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
          <label className="border border-dashed border-[#1e293b] rounded px-3 py-2 text-[11px] text-slate-400 cursor-pointer hover:border-emerald-500/40">
            <input
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? <span className="text-slate-200 font-mono">{file.name}</span> : 'choose a .ko or .kpm'}
          </label>
          <input
            value={vermagic}
            onChange={(e) => setVermagic(e.target.value)}
            placeholder="target vermagic (optional), e.g. 6.12.0-g7042991a SMP preempt mod_unload"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
          />
          <button
            onClick={inspect}
            disabled={!file || busy}
            className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Inspect
          </button>
        </div>

        {report && (
          <div className="mt-3 border border-[#1e293b] rounded-lg p-3 bg-[#0b1220] space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
                  report.facts.format === 'lkm'
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    : report.facts.format === 'kpm'
                    ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                    : 'border-slate-600 text-slate-400'
                }`}
              >
                {String(report.facts.format).toUpperCase()}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">{report.facts.bytes} bytes</span>
              <span className="text-[10px] text-slate-500 font-mono">{report.facts.arch}</span>
            </div>

            {report.facts.modinfo && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                {Object.entries(report.facts.modinfo).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-slate-500">{k}</div>
                    <div className="text-slate-200 font-mono break-all">{String(v ?? '—')}</div>
                  </div>
                ))}
              </div>
            )}

            {report.facts.vermagic && (
              <div className="text-[10px]">
                <span className="text-slate-500">vermagic: </span>
                <span className="font-mono text-slate-200">{report.facts.vermagic}</span>
              </div>
            )}
            {report.vermagic && report.vermagic.match === true && (
              <div className="text-[10px] text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> vermagic identical to the target kernel
              </div>
            )}
            {report.facts.undefinedSymbols !== undefined && (
              <details className="text-[10px]">
                <summary className="text-slate-400 cursor-pointer">
                  {report.facts.undefinedSymbols} undefined symbol(s) — the kernel must provide these
                </summary>
                <div className="mt-1 font-mono text-[9px] text-slate-500 max-h-32 overflow-auto columns-2">
                  {(report.facts.undefinedSample ?? []).map((s: string, i: number) => (
                    <div key={i}>{s}</div>
                  ))}
                </div>
              </details>
            )}

            {report.notes?.map((n: string, i: number) => (
              <div key={i} className="text-[10px] text-sky-300/90 flex items-start gap-1">
                <Info className="w-3 h-3 shrink-0 mt-0.5" /> {n}
              </div>
            ))}
            {report.warnings?.map((w: string, i: number) => (
              <div key={i} className="text-[10px] text-amber-300 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
          <FileCode2 className="w-4 h-4 text-sky-400" /> Scaffold a module
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto_auto] gap-2">
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-2 text-[11px] text-slate-200"
          >
            {(catalog?.buildTemplates ?? ['minimal-kmod']).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-sky-500/50"
          />
          <button
            onClick={buildScaffold}
            disabled={busy}
            className="bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-2 rounded"
          >
            Generate
          </button>
          <button
            onClick={getSnippet}
            className="border border-[#1e293b] text-slate-300 hover:text-white text-xs px-3 py-2 rounded flex items-center gap-1"
          >
            <GitMerge className="w-3 h-3" /> CI step
          </button>
        </div>

        {snippet && (
          <pre className="mt-2 bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-emerald-300 overflow-auto">
            {snippet}
          </pre>
        )}

        {scaffold && (
          <div className="mt-3 space-y-2">
            {scaffold.files.map((f: any) => (
              <details key={f.path} className="border border-[#1e293b] rounded bg-[#0b1220]">
                <summary className="px-2 py-1.5 text-[11px] font-mono text-slate-200 cursor-pointer flex items-center justify-between">
                  {f.path}
                  <button
                    onClick={(ev) => {
                      ev.preventDefault();
                      navigator.clipboard?.writeText(f.contents);
                    }}
                    className="text-slate-500 hover:text-white"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </summary>
                <pre className="px-2 pb-2 text-[10px] font-mono text-slate-300 overflow-auto max-h-72">{f.contents}</pre>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* ---------- patch / diff builder ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <GitMerge className="w-4 h-4 text-violet-400" /> Patch / diff builder
        </h3>
        <p className="text-[11px] text-slate-400 mb-2">
          Two trees or two files in, one patch out. A <span className="font-mono text-slate-300">.patch</span> is
          git-style and applies with <span className="font-mono">-p1</span> — that is what a KPM build and a CI
          step expect. A <span className="font-mono text-slate-300">.diff</span> is a plain unified diff.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <input
            value={origPath}
            onChange={(e) => setOrigPath(e.target.value)}
            placeholder="original path (tree or file)"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
          <input
            value={modPath}
            onChange={(e) => setModPath(e.target.value)}
            placeholder="modified path"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as 'patch' | 'diff')}
            className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1.5 text-[11px] text-slate-200"
          >
            <option value="patch">.patch (git-style, -p1)</option>
            <option value="diff">.diff (plain unified)</option>
          </select>
          <label className="text-[10px] text-slate-400 flex items-center gap-1">
            context
            <input
              type="number"
              min={0}
              max={20}
              value={ctxLines}
              onChange={(e) => setCtxLines(Number(e.target.value))}
              className="w-14 bg-[#0b1220] border border-[#1e293b] rounded px-1.5 py-1 text-[11px] text-slate-200"
            />
          </label>
          <button
            onClick={buildPatchNow}
            disabled={busy || !origPath || !modPath}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded"
          >
            Build {style}
          </button>
        </div>

        {patchResult && (
          <div className="mt-3">
            {patchResult.error ? (
              <div className="text-[11px] text-rose-300 flex items-start gap-1">
                <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {patchResult.error}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-3 text-[10px] text-slate-400 mb-1">
                  <span className="text-emerald-300">+{patchResult.additions}</span>
                  <span className="text-rose-300">-{patchResult.deletions}</span>
                  <span>{patchResult.files} file(s)</span>
                  <span>{patchResult.bytes} bytes</span>
                  <span>{patchResult.hunks?.length ?? 0} hunk(s)</span>
                </div>
                {patchResult.warnings?.map((w: string, i: number) => (
                  <div key={i} className="text-[10px] text-amber-300 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
                  </div>
                ))}
                <pre className="mt-1 bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-slate-300 overflow-auto max-h-80">
                  {patchResult.patch}
                </pre>
                <button
                  onClick={() => navigator.clipboard?.writeText(patchResult.patch)}
                  className="mt-1 text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> copy {style}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* ---------- KPM recipe ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <FileCode2 className="w-4 h-4 text-fuchsia-400" /> KPM recipe
        </h3>
        <p className="text-[11px] text-slate-400 mb-2">
          A KPM is built against a full kernel tree and applies its patch series in order with{' '}
          <span className="font-mono">patch -p1</span>. This emits the series file, the Kbuild, a skeleton module and
          a build script.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2">
          <input
            value={patchNames}
            onChange={(e) => setPatchNames(e.target.value)}
            placeholder="0001-foo.patch 0002-bar.patch"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600"
          />
          <input
            value={kernelVersion}
            onChange={(e) => setKernelVersion(e.target.value)}
            placeholder="target kernel, e.g. 5.10.240"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600"
          />
          <button
            onClick={buildRecipe}
            disabled={busy}
            className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-2 rounded"
          >
            Generate
          </button>
        </div>

        {recipe && (
          <div className="mt-3 space-y-2">
            {recipe.files.map((f: any) => (
              <details key={f.path} className="border border-[#1e293b] rounded bg-[#0b1220]">
                <summary className="px-2 py-1.5 text-[11px] font-mono text-slate-200 cursor-pointer flex items-center justify-between">
                  {f.path}
                  <button
                    onClick={(ev) => {
                      ev.preventDefault();
                      navigator.clipboard?.writeText(f.contents);
                    }}
                    className="text-slate-500 hover:text-white"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </summary>
                <pre className="px-2 pb-2 text-[10px] font-mono text-slate-300 overflow-auto max-h-72">{f.contents}</pre>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* ---------- ISO livepatch ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <Wrench className="w-4 h-4 text-lime-400" /> ISO livepatch
        </h3>
        <p className="text-[11px] text-slate-400 mb-2">
          The desktop kernel has livepatch built in, so the image needs no module for support. A payload is only
          needed to patch a function without rebooting — and a payload whose vermagic does not match will load and
          patch nothing, which is worse than failing.
        </p>

        {lpData && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(lpData.requiredConfig as string[]).map((k) => (
              <span key={k} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#1e293b] text-slate-400">
                {k}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            placeholder="paste the kernel .config (or just the CONFIG_LIVEPATCH lines)"
            rows={5}
            className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1.5 text-[10px] font-mono text-slate-200 placeholder:text-slate-600"
          />
          <div className="space-y-2">
            <input
              value={lpPayload}
              onChange={(e) => setLpPayload(e.target.value)}
              placeholder="payload .ko path (optional)"
              className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600"
            />
            <input
              value={lpVermagic}
              onChange={(e) => setLpVermagic(e.target.value)}
              placeholder="kernel vermagic to match against"
              className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600"
            />
            <div className="flex gap-2">
              <button
                onClick={checkLivepatch}
                disabled={busy || (!configText && !lpPayload)}
                className="bg-lime-600 hover:bg-lime-500 disabled:opacity-40 text-slate-950 text-xs font-bold px-3 py-1.5 rounded"
              >
                Check
              </button>
              <button
                onClick={loadFragment}
                className="border border-[#1e293b] text-slate-300 hover:text-white text-xs px-3 py-1.5 rounded flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> fuse fragment
              </button>
            </div>
          </div>
        </div>

        {lpCheck?.kernel && (
          <div className="mt-2 space-y-0.5">
            <div className={`text-[11px] font-bold flex items-center gap-1 ${lpCheck.kernel.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {lpCheck.kernel.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {lpCheck.kernel.summary}
            </div>
            {lpCheck.kernel.facts.map((f: any) => (
              <div key={f.key} className="text-[10px] flex items-center gap-2">
                <span className={`font-mono ${f.satisfied ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {f.key}={f.value ?? '(unset)'}
                </span>
                <span className="text-slate-500">{f.note}</span>
              </div>
            ))}
          </div>
        )}

        {lpCheck?.payload && (
          <div className="mt-2 border border-[#1e293b] rounded p-2 bg-[#0b1220]">
            <div className={`text-[11px] font-bold ${lpCheck.payload.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              payload: {lpCheck.payload.file}
            </div>
            <div className="text-[10px] text-slate-400 font-mono">vermagic: {lpCheck.payload.vermagic ?? '—'}</div>
            <div className="text-[10px] text-slate-400">
              matches kernel: {lpCheck.payload.matchesKernel === null ? 'not checked' : lpCheck.payload.matchesKernel ? 'yes' : 'NO'}
            </div>
            {lpCheck.payload.warnings?.map((w: string, i: number) => (
              <div key={i} className="text-[10px] text-amber-300 flex items-start gap-1 mt-0.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
              </div>
            ))}
          </div>
        )}

        {fragment && (
          <div className="mt-2">
            <div className="text-[10px] text-slate-400 mb-1">paste into fuse_darkmatter_nh.sh</div>
            <pre className="bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-lime-300 overflow-auto max-h-72">
              {fragment}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recovery Lab                                                        */
/* ------------------------------------------------------------------ */

interface RecoveryCatalog {
  families: Array<{
    id: string;
    name: string;
    lineage: string;
    unit: string;
    buildEntry: string;
    requires: string[];
    files: Record<string, string>;
  }>;
  profiles: Array<any>;
  crossPortDimensions: string[];
}

function RecoveryLab({ plugin }: { plugin: Plugin }) {
  const [catalog, setCatalog] = useState<RecoveryCatalog | null>(null);
  const [family, setFamily] = useState('orangefox');
  const [profileId, setProfileId] = useState('');
  const [scaffold, setScaffold] = useState<any>(null);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [donorFstab, setDonorFstab] = useState('');
  const [donorBoard, setDonorBoard] = useState('');
  const [targetFstab, setTargetFstab] = useState('');
  const [targetBoard, setTargetBoard] = useState('');
  const [portReport, setPortReport] = useState<any>(null);

  useEffect(() => {
    api(`${plugin.endpointBase}/catalog`)
      .then((d) => {
        setCatalog(d);
        if (d.profiles?.[0]) setProfileId(d.profiles[0].id);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [plugin.endpointBase]);

  const scaffoldTree = useCallback(async () => {
    if (!profileId) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api(`${plugin.endpointBase}/scaffold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, family }),
      });
      setScaffold(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [profileId, family, plugin.endpointBase]);

  const getSnippet = useCallback(async () => {
    try {
      const d = await api(`${plugin.endpointBase}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family, profileId }),
      });
      setSnippet(d.snippet);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [family, profileId, plugin.endpointBase]);

  const crossPort = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api(`${plugin.endpointBase}/crossport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donorFstab, donorBoardConfig: donorBoard, targetFstab, targetBoardConfig: targetBoard, targetProfile: profileId }),
      });
      setPortReport(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [donorFstab, donorBoard, targetFstab, targetBoard, profileId, plugin.endpointBase]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
          <HardDrive className="w-4 h-4 text-orange-400" /> Compose a recovery tree
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-2">
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-2 text-[11px] text-slate-200"
          >
            {(catalog?.families ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.lineage}
              </option>
            ))}
          </select>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-2 text-[11px] text-slate-200"
          >
            {(catalog?.profiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.vendor} {p.codename} — {p.soc} ({p.arch})
              </option>
            ))}
          </select>
          <button
            onClick={scaffoldTree}
            disabled={busy || !profileId}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-2 rounded"
          >
            Generate tree
          </button>
          <button
            onClick={getSnippet}
            className="border border-[#1e293b] text-slate-300 hover:text-white text-xs px-3 py-2 rounded flex items-center gap-1"
          >
            <GitMerge className="w-3 h-3" /> CI step
          </button>
        </div>

        {snippet && (
          <pre className="mt-2 bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-orange-300 overflow-auto">
            {snippet}
          </pre>
        )}

        {catalog && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {catalog.families.map((f) => (
              <div key={f.id} className="border border-[#1e293b] bg-[#0b1220] rounded p-2 text-[10px]">
                <div className="text-xs font-bold text-white">{f.name}</div>
                <div className="text-slate-400 mt-0.5">{f.lineage}</div>
                <div className="mt-1 font-mono text-slate-300">{f.unit}</div>
                <div className="mt-1 text-slate-500">build: <span className="font-mono">{f.buildEntry}</span></div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.requires.map((r) => (
                    <span key={r} className="px-1 rounded bg-slate-800 text-slate-400 font-mono">{r}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {scaffold && (
          <div className="mt-3 space-y-2">
            <div className="text-[10px] text-slate-500">
              root: <span className="font-mono text-slate-300">{scaffold.root}/</span> — {scaffold.files.length} files
            </div>
            {scaffold.files.map((f: any) => (
              <details key={f.path} className="border border-[#1e293b] rounded bg-[#0b1220]">
                <summary className="px-2 py-1.5 text-[11px] font-mono text-slate-200 cursor-pointer flex items-center justify-between">
                  {f.path}
                  <button
                    onClick={(ev) => {
                      ev.preventDefault();
                      navigator.clipboard?.writeText(f.contents);
                    }}
                    className="text-slate-500 hover:text-white"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </summary>
                <pre className="px-2 pb-2 text-[10px] font-mono text-slate-300 overflow-auto max-h-72">{f.contents}</pre>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <Wrench className="w-4 h-4 text-violet-400" /> Cross-port analysis
        </h3>
        <p className="text-[11px] text-slate-400 mb-3">
          Paste the donor and target configs. Nothing is copied — the lab only names what disagrees, in the
          order it will break.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
            { label: 'donor fstab', value: donorFstab, set: setDonorFstab, ph: '/dev/block/bootdevice/by-name/system  ext4  /system  flags=...' },
            { label: 'target fstab', value: targetFstab, set: setTargetFstab, ph: '…target device fstab…' },
            { label: 'donor BoardConfig.mk', value: donorBoard, set: setDonorBoard, ph: 'BOARD_KERNEL_PAGESIZE := 4096' },
            { label: 'target BoardConfig.mk', value: targetBoard, set: setTargetBoard, ph: '…target BoardConfig…' },
          ].map((f) => (
            <div key={f.label}>
              <div className="text-[10px] text-slate-400 mb-1">{f.label}</div>
              <textarea
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                placeholder={f.ph}
                rows={6}
                className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1.5 text-[10px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          ))}
        </div>

        <button
          onClick={crossPort}
          disabled={busy || !donorFstab || !profileId}
          className="mt-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded"
        >
          Compare
        </button>

        {portReport && (
          <div className="mt-3 space-y-2">
            <div
              className={`text-[11px] font-bold flex items-center gap-2 ${
                portReport.summary.conflicts > 0 ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {portReport.summary.conflicts > 0 ? (
                <XCircle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              {portReport.summary.verdict}
            </div>
            <div className="flex gap-3 text-[10px] text-slate-400">
              <span>{portReport.summary.conflicts} blocking</span>
              <span>{portReport.summary.warnings} warning</span>
              <span>{portReport.summary.compatible} compatible</span>
            </div>

            {portReport.conflicts.map((c: any, i: number) => (
              <div key={i} className="border border-rose-500/25 bg-rose-500/5 rounded p-2 text-[10px]">
                <div className="text-rose-300 font-semibold">
                  {c.area}
                  {c.mount ? ` · ${c.mount}` : ''}
                  {c.key ? ` · ${c.key}` : ''}
                </div>
                <div className="text-slate-300 mt-0.5">{c.problem}</div>
                {c.fix && <div className="text-emerald-300/90 mt-1">fix: {c.fix}</div>}
              </div>
            ))}
            {portReport.warnings.map((w: any, i: number) => (
              <div key={i} className="border border-amber-500/20 bg-amber-500/5 rounded p-2 text-[10px]">
                <div className="text-amber-300 font-semibold">
                  {w.area}
                  {w.mount ? ` · ${w.mount}` : ''}
                  {w.key ? ` · ${w.key}` : ''}
                </div>
                <div className="text-slate-300 mt-0.5">{w.problem}</div>
                {w.note && <div className="text-slate-400 mt-1 italic">{w.note}</div>}
              </div>
            ))}
            {portReport.ok.length > 0 && (
              <details className="text-[10px]">
                <summary className="text-slate-400 cursor-pointer">{portReport.ok.length} compatible item(s)</summary>
                <div className="mt-1 space-y-0.5">
                  {portReport.ok.map((o: string, i: number) => (
                    <div key={i} className="text-emerald-300/80 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {o}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {catalog && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white mb-2">What a cross-port has to reconcile</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {catalog.crossPortDimensions.map((d, i) => (
              <li key={i} className="text-[10px] text-slate-400 flex items-start gap-1">
                <Info className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" /> {d}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Low-Level Research Lab: EDL / EUD / QDL / Hexagon                   */
/* ------------------------------------------------------------------ */

interface LLTransport {
  id: string;
  mode: string;
  name: string;
  usb: string[];
  protocol: string[];
  hostTools: Array<{ name: string; pkg: string; speaks: string; config: string }>;
  writes: string;
  requirements: string[];
  cautions: string[];
}

interface ForkEntry {
  id: string;
  transport: string;
  label: string;
  upstream: string;
  fork: string | null;
  branch: string;
  localPath: string | null;
  purpose: string;
  expects: string[];
}

interface ForkStatus {
  entry: ForkEntry;
  upstreamReachable: boolean | null;
  forkReachable: boolean | null;
  ahead: number | null;
  behind: number | null;
  checkout: boolean;
  checkoutBranch: string | null;
  dirty: boolean | null;
  missingExpected: string[];
  warnings: string[];
  errors: string[];
}

interface LLCatalog {
  transports: LLTransport[];
  usbIds: Array<{ id: string; name: string; note: string }>;
  programmers: Array<{ soc: string; file: string; note: string }>;
  imageFormats: Array<{ ext: string; what: string; repack: string }>;
  probe: string;
}

function LowLevelLab({ plugin }: { plugin: Plugin }) {
  const [catalog, setCatalog] = useState<LLCatalog | null>(null);
  const [tools, setTools] = useState<Array<{ tool: string; path: string | null; unlocks: string[] }>>([]);
  const [error, setError] = useState<string | null>(null);

  const [routeName, setRouteName] = useState('');
  const [routeResult, setRouteResult] = useState<any>(null);

  const [rawprogram, setRawprogram] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const [forks, setForks] = useState<ForkEntry[]>([]);
  const [forkStatus, setForkStatus] = useState<Record<string, ForkStatus>>({});
  const [checking, setChecking] = useState(false);
  const [recipe, setRecipe] = useState<{ id: string; lines: string[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api(`${plugin.endpointBase}/catalog`),
      api(`${plugin.endpointBase}/tools`),
      api(`${plugin.endpointBase}/forks`),
    ])
      .then(([c, t, f]) => {
        setCatalog(c);
        setTools(t.tools ?? []);
        setForks(f.forks ?? []);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [plugin.endpointBase]);

  const checkForks = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const d = await api(`${plugin.endpointBase}/forks/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const map: Record<string, ForkStatus> = {};
      for (const r of d.results ?? []) map[r.entry.id] = r;
      setForkStatus(map);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setChecking(false);
    }
  }, [plugin.endpointBase]);

  const saveFork = useCallback(
    async (entry: ForkEntry) => {
      try {
        const d = await api(`${plugin.endpointBase}/forks/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
        setForks(d.forks ?? []);
        setEditing(null);
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    },
    [plugin.endpointBase],
  );

  const loadRecipe = useCallback(
    async (id: string) => {
      try {
        const d = await api(`${plugin.endpointBase}/forks/recipe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        setRecipe(d);
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    },
    [plugin.endpointBase],
  );

  const routePartition = useCallback(async () => {
    if (!routeName.trim()) return;
    setBusy(true);
    try {
      const d = await api(`${plugin.endpointBase}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partition: routeName }),
      });
      setRouteResult(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [routeName, plugin.endpointBase]);

  const checkPlan = useCallback(async () => {
    if (!rawprogram.trim()) return;
    setBusy(true);
    try {
      const d = await api(`${plugin.endpointBase}/firehose-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawprogram }),
      });
      setPlan(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [rawprogram, plugin.endpointBase]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="text-[11px] text-amber-200 bg-amber-500/5 border border-amber-500/25 rounded p-2 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Everything here is read-mostly by design. EDL writes go through Firehose with a physical-partition number,
          and a wrong number overwrites the GPT. There is no one-click flash in this lab.
        </span>
      </div>

      {/* transports */}
      {catalog && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {catalog.transports.map((t) => (
            <div key={t.id} className="border border-[#1e293b] bg-[#0b1220] rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white">{t.name}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{t.mode}</div>
                </div>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded border font-mono shrink-0 ${
                    t.writes.startsWith('yes')
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                      : t.writes.startsWith('no')
                      ? 'border-slate-600 text-slate-400'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {t.id.toUpperCase()}
                </span>
              </div>

              {t.usb.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.usb.map((u) => (
                    <span key={u} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                      {u}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">protocol</div>
                {t.protocol.map((p, i) => (
                  <div key={i} className="text-[10px] text-slate-300">{p}</div>
                ))}
              </div>

              <div className="mt-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">host tools</div>
                {t.hostTools.map((h, i) => (
                  <div key={i} className="text-[10px]">
                    <span className="font-mono text-emerald-300">{h.name}</span>
                    <span className="text-slate-500"> · {h.pkg}</span>
                    {h.speaks !== '—' && <span className="text-slate-400"> — {h.speaks}</span>}
                  </div>
                ))}
              </div>

              <div className="mt-2">
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">writes</div>
                <div className="text-[10px] text-slate-300">{t.writes}</div>
              </div>

              {t.cautions.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {t.cautions.map((c, i) => (
                    <div key={i} className="text-[10px] text-amber-300/90 flex items-start gap-1">
                      <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" /> {c}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* host tools */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-xs font-bold text-white flex items-center gap-2 mb-2">
          <Wrench className="w-3.5 h-3.5 text-cyan-400" /> Host tools
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
          {tools.map((t) => (
            <div key={t.tool} className="flex items-start gap-2 text-[10px]">
              {t.path ? (
                <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-rose-400" />
              )}
              <div>
                <span className="font-mono text-slate-200">{t.tool}</span>
                <span className="text-slate-500"> — {t.path ? 'present' : 'missing'}</span>
                {!t.path && t.unlocks.length > 0 && (
                  <div className="text-[9px] text-slate-500">blocks: {t.unlocks.join('; ')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        {catalog && (
          <div className="mt-2 text-[10px] text-slate-400">
            Safe probe anywhere: <span className="font-mono text-cyan-300">{catalog.probe}</span>
          </div>
        )}
      </section>

      {/* route a partition */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-xs font-bold text-white mb-1">How would this partition be reached?</h3>
        <p className="text-[11px] text-slate-400 mb-2">
          Type a partition name from your dump. The answer says which transport reaches it and what that costs.
        </p>
        <div className="flex gap-2">
          <input
            value={routeName}
            onChange={(e) => setRouteName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && routePartition()}
            placeholder="xbl_b, modem_a, dsp, boot, adsp.mbn …"
            className="flex-1 bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600"
          />
          <button
            onClick={routePartition}
            disabled={busy || !routeName.trim()}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-2 rounded"
          >
            Route
          </button>
        </div>

        {routeResult && (
          <div className="mt-2 space-y-1">
            {routeResult.routes.map((r: any, i: number) => (
              <div key={i} className="border border-[#1e293b] rounded p-2 text-[10px] bg-[#0b1220]">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-cyan-300 uppercase">{r.transport}</span>
                  <span className="text-slate-300">{r.why}</span>
                </div>
                <div className="text-slate-400 mt-0.5">tool: <span className="font-mono">{r.tool}</span></div>
                <div className={r.risk.startsWith('high') ? 'text-rose-300 mt-0.5' : 'text-slate-400 mt-0.5'}>
                  risk: {r.risk}
                </div>
                {r.also && <div className="text-amber-300/90 mt-0.5">{r.also}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* firehose dry run */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-xs font-bold text-white mb-1">Firehose XML dry run</h3>
        <p className="text-[11px] text-slate-400 mb-2">
          Paste a <span className="font-mono">rawprogram*.xml</span>. Nothing is sent — this only reads the program
          list and reports the writes, the LUNs and anything that looks like a mismatch.
        </p>
        <textarea
          value={rawprogram}
          onChange={(e) => setRawprogram(e.target.value)}
          rows={6}
          placeholder={'<program SECTOR_SIZE_IN_BYTES="4096" filename="xbl.elf" label="xbl" physical_partition_number="0" start_sector="..." />'}
          className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1.5 text-[10px] font-mono text-slate-200 placeholder:text-slate-600"
        />
        <button
          onClick={checkPlan}
          disabled={busy || !rawprogram.trim()}
          className="mt-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded"
        >
          Analyse (no writes)
        </button>

        {plan && (
          <div className="mt-2 text-[10px] space-y-1">
            <div className="flex flex-wrap gap-3 text-slate-300">
              <span>{plan.programs} program entries</span>
              <span className="text-emerald-300">{plan.writes} writes</span>
              <span className="text-rose-300">{plan.erases} erase/blank</span>
              <span>LUNs: {plan.luns.join(', ')}</span>
            </div>
            {plan.warnings.length === 0 ? (
              <div className="text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> no structural problems found
              </div>
            ) : (
              plan.warnings.map((w: string, i: number) => (
                <div key={i} className="text-amber-300 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
                </div>
              ))
            )}
            <div className="text-slate-500 italic">{plan.ordering}</div>
          </div>
        )}
      </section>

      {/* fork registry */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <GitMerge className="w-3.5 h-3.5 text-violet-400" /> Fork registry
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Each transport's upstream and fork. A check reports the three things that decay: is the fork reachable,
              does it still track upstream, and does the local checkout match.
            </p>
          </div>
          <button
            onClick={checkForks}
            disabled={checking}
            className="flex items-center gap-1.5 border border-[#1e293b] text-slate-300 hover:text-white text-[11px] px-2.5 py-1.5 rounded"
          >
            {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Check all
          </button>
        </div>

        <div className="space-y-2 mt-2">
          {forks.map((f) => {
            const st = forkStatus[f.id];
            const isEditing = editing === f.id;
            return (
              <div key={f.id} className="border border-[#1e293b] rounded-lg p-2.5 bg-[#0b1220]">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-white">{f.label}</span>
                      <span className="text-[9px] font-mono px-1 rounded border border-slate-700 text-slate-400">
                        {f.transport}
                      </span>
                      {st && (
                        <span className="flex gap-1">
                          {st.checkout && !st.dirty && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                          {st.dirty && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                          {!st.checkout && f.localPath && <XCircle className="w-3 h-3 text-rose-400" />}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{f.purpose}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(isEditing ? null : f.id)}
                      className="text-[10px] border border-[#1e293b] text-slate-400 hover:text-white px-2 py-0.5 rounded"
                    >
                      {isEditing ? 'cancel' : 'edit'}
                    </button>
                    <button
                      onClick={() => loadRecipe(f.id)}
                      className="text-[10px] border border-[#1e293b] text-slate-400 hover:text-white px-2 py-0.5 rounded"
                    >
                      remotes
                    </button>
                  </div>
                </div>

                {!isEditing ? (
                  <div className="mt-1.5 space-y-0.5 text-[10px] font-mono">
                    <div className="text-slate-500">
                      upstream: <span className="text-slate-300">{f.upstream || <span className="text-rose-400">not set</span>}</span>
                    </div>
                    <div className="text-slate-500">
                      fork: <span className={f.fork ? 'text-emerald-300' : 'text-rose-400'}>{f.fork || 'not set'}</span>
                    </div>
                    <div className="text-slate-500">
                      local: <span className={f.localPath ? 'text-slate-300' : 'text-rose-400'}>{f.localPath || 'not set'}</span>
                    </div>
                    <div className="text-slate-500">
                      branch: <span className="text-slate-300">{f.branch}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {([
                      ['upstream', 'upstream URL'],
                      ['fork', 'fork URL'],
                      ['localPath', 'local checkout path'],
                      ['branch', 'branch'],
                    ] as Array<[keyof ForkEntry, string]>).map(([key, ph]) => (
                      <input
                        key={String(key)}
                        value={String(f[key] ?? '')}
                        onChange={(e) =>
                          setForks((prev) => prev.map((x) => (x.id === f.id ? { ...x, [key]: key === 'branch' ? (e.target.value || 'main') : (e.target.value || null) } : x)))
                        }
                        placeholder={ph}
                        className="bg-[#0f172a] border border-[#1e293b] rounded px-2 py-1 text-[10px] font-mono text-slate-200 placeholder:text-slate-600"
                      />
                    ))}
                    <button
                      onClick={() => saveFork(f)}
                      className="bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold px-3 py-1.5 rounded"
                    >
                      Save {f.label}
                    </button>
                  </div>
                )}

                {st && (
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
                    {st.ahead !== null && (
                      <span className={st.ahead === 0 ? 'text-amber-300' : 'text-emerald-300'}>
                        {st.ahead} own commit(s)
                      </span>
                    )}
                    {st.behind !== null && (
                      <span className={st.behind > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                        {st.behind} behind upstream
                      </span>
                    )}
                    {st.checkoutBranch && <span className="text-slate-400">on {st.checkoutBranch}</span>}
                    {st.upstreamReachable === false && <span className="text-rose-300">upstream unreachable</span>}
                    {st.forkReachable === false && <span className="text-rose-300">fork unreachable</span>}
                  </div>
                )}
                {st?.warnings.map((w, i) => (
                  <div key={i} className="mt-0.5 text-[10px] text-amber-300 flex items-start gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" /> {w}
                  </div>
                ))}
                {st?.errors.map((w, i) => (
                  <div key={i} className="mt-0.5 text-[10px] text-rose-300 flex items-start gap-1">
                    <XCircle className="w-2.5 h-2.5 shrink-0 mt-0.5" /> {w}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {recipe && (
          <div className="mt-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-slate-400">
                remote rewiring for <span className="font-mono text-slate-200">{recipe.id}</span>
              </div>
              <button
                onClick={() => navigator.clipboard?.writeText(recipe.lines.join('\n'))}
                className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> copy
              </button>
            </div>
            <pre className="mt-1 bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-violet-300 overflow-auto">
              {recipe.lines.join('\n')}
            </pre>
          </div>
        )}
      </section>

      {/* reference tables */}
      {catalog && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
            <h3 className="text-xs font-bold text-white mb-2">USB ids</h3>
            <div className="space-y-0.5">
              {catalog.usbIds.map((u) => (
                <div key={u.id} className="text-[10px] flex items-baseline gap-2">
                  <span className="font-mono text-cyan-300 shrink-0">{u.id}</span>
                  <span className="text-slate-300">{u.name}</span>
                  <span className="text-slate-500">— {u.note}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
            <h3 className="text-xs font-bold text-white mb-2">Firehose programmers</h3>
            <div className="space-y-1">
              {catalog.programmers.map((p) => (
                <div key={p.soc} className="text-[10px]">
                  <span className="text-slate-200 font-mono">{p.soc}</span>
                  <span className="text-slate-500"> · {p.file}</span>
                  {p.note && <div className="text-slate-500 pl-2">{p.note}</div>}
                </div>
              ))}
            </div>
            <h3 className="text-xs font-bold text-white mt-3 mb-1">Image formats</h3>
            <div className="space-y-0.5">
              {catalog.imageFormats.map((f) => (
                <div key={f.ext} className="text-[10px]">
                  <span className="font-mono text-emerald-300">{f.ext}</span>
                  <span className="text-slate-400"> — {f.what}</span>
                  <span className={f.repack === 'keep-original' ? 'text-rose-300' : 'text-slate-500'}> (repack: {f.repack})</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Boot splash                                                       */
/* ------------------------------------------------------------------ */

interface SplashPreset {
  id: string;
  label: string;
  background: string[];
  accent: string;
  secondary: string;
  style: string;
}

function BootSplashPanel({ plugin }: { plugin: Plugin }) {
  const [formats, setFormats] = useState<any>(null);
  const [preset, setPreset] = useState('dark-hunter');
  const [target, setTarget] = useState('bootanimation');
  const [style, setStyle] = useState('ring');
  const [title, setTitle] = useState('ANYREALM');
  const [size, setSize] = useState({ w: 1080, h: 2400 });
  const [fps, setFps] = useState(24);
  const [frames, setFrames] = useState(24);
  const [showProgress, setShowProgress] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [outputs, setOutputs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState(0);

  const load = useCallback(async () => {
    try {
      const [f, o] = await Promise.all([
        api(`${plugin.endpointBase}/formats`),
        api(`${plugin.endpointBase}/outputs`),
      ]);
      setFormats(f);
      setOutputs(o.outputs ?? []);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [plugin.endpointBase]);

  useEffect(() => {
    load();
  }, [load]);

  // Size presets follow the target: a phone animation and a laptop panel have
  // nothing in common, and picking the wrong one is a stretched result.
  useEffect(() => {
    if (target === 'plymouth') {
      setSize({ w: 1366, h: 768 });
    } else {
      setSize({ w: 1080, h: 2400 });
    }
  }, [target]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api(`${plugin.endpointBase}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          preset,
          style,
          title,
          width: size.w,
          height: size.h,
          fps,
          frames,
          showProgress,
        }),
      });
      setResult(d);
      setPreviewFrame(0);
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [target, preset, style, title, size, fps, frames, showProgress, load, plugin.endpointBase]);

  const previewUrl = result?.preview
    ? `${result.preview}&frame=${previewFrame}`.replace(/frame=\d+&frame=/, 'frame=')
    : null;

  const presets: SplashPreset[] = formats?.presets ?? [];
  const current = presets.find((p) => p.id === preset);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">✕</button>
        </div>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-xs font-bold text-white flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" /> Target
        </h3>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {(formats?.targets ?? []).map((t: any) => {
            const on = target === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTarget(t.id)}
                className={`text-left border rounded-lg p-2.5 ${
                  on ? 'border-fuchsia-500/50 bg-fuchsia-500/5' : 'border-[#1e293b] bg-[#0b1220] hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white">{t.label}</span>
                  {on && <CheckCircle2 className="w-3.5 h-3.5 text-fuchsia-400" />}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{t.detail}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">{t.placement}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(formats?.targets?.find((t: any) => t.id === target)?.sizes ?? []).map((s: any) => {
            const on = size.w === s.w && size.h === s.h;
            return (
              <button
                key={`${s.w}x${s.h}`}
                onClick={() => setSize({ w: s.w, h: s.h })}
                title={s.note}
                className={`text-[10px] font-mono px-2 py-1 rounded border ${
                  on ? 'border-fuchsia-500/40 text-fuchsia-200 bg-fuchsia-500/5' : 'border-[#1e293b] text-slate-400 hover:text-white'
                }`}
              >
                {s.w}×{s.h}
              </button>
            );
          })}
        </div>
      </section>

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-xs font-bold text-white flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-fuchsia-400" /> Look
        </h3>

        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
          {presets.map((p) => {
            const on = preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setPreset(p.id);
                  setStyle(p.style);
                }}
                className={`border rounded-lg p-2 text-left ${on ? 'border-fuchsia-500/50' : 'border-[#1e293b]'}`}
                style={{
                  background: `linear-gradient(160deg, ${p.background[0]}, ${p.background[1]})`,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: p.accent }} />
                  <span className="w-2 h-2 rounded-full" style={{ background: p.secondary }} />
                </div>
                <div className="text-[10px] font-bold text-white mt-1">{p.label}</div>
                <div className="text-[9px] text-slate-400">{p.style}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-[10px] text-slate-400 flex flex-col gap-0.5">
            title (A-Z 0-9 - . :)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-fuchsia-500/50"
            />
          </label>
          <label className="text-[10px] text-slate-400 flex flex-col gap-0.5">
            style
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/50"
            >
              <option value="ring">ring — arc rotates</option>
              <option value="pulse">pulse — breathing rings</option>
              <option value="scan">scan — sweeping line</option>
              <option value="dot">dot — stepped dots</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-400 flex flex-col gap-0.5">
              fps
              <input
                type="number"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/50"
              />
            </label>
            <label className="text-[10px] text-slate-400 flex flex-col gap-0.5">
              frames
              <input
                type="number"
                value={frames}
                onChange={(e) => setFrames(Number(e.target.value))}
                className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/50"
              />
            </label>
          </div>
        </div>

        <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
          <input
            type="checkbox"
            checked={showProgress}
            onChange={(e) => setShowProgress(e.target.checked)}
            className="accent-fuchsia-500"
          />
          show a progress bar — only when the boot can actually report progress, or it reads as a lie
        </label>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={generate}
            disabled={busy}
            className="flex items-center gap-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate {frames} frames
          </button>
          <span className="text-[10px] text-slate-500">
            {size.w}×{size.h} · {(frames / fps).toFixed(2)}s loop
          </span>
        </div>
      </section>

      {result && (
        <section className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <div className="text-xs font-bold text-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {result.target} written
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {result.frames} frames · {result.size} · {result.bytes ? `${(result.bytes / 1024).toFixed(0)} KB` : 'theme files'}
                {result.stored && ' · entries stored, not deflated'}
              </div>
              <div className="text-[10px] font-mono text-slate-500 break-all mt-1">{result.zipPath ?? result.themeDir}</div>
            </div>
            {result.preview && (
              <img
                src={`${plugin.endpointBase}/preview?dir=${encodeURIComponent(result.dir.split('/').pop())}&frame=${previewFrame}`}
                alt="first frame"
                className="w-32 rounded border border-[#1e293b]"
              />
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setPreviewFrame((f) => Math.max(0, f - 1))}
              className="text-[10px] px-2 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-white"
            >
              ‹
            </button>
            <span className="text-[10px] font-mono text-slate-400">
              frame {previewFrame + 1} / {result.frames}
            </span>
            <button
              onClick={() => setPreviewFrame((f) => Math.min(result.frames - 1, f + 1))}
              className="text-[10px] px-2 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-white"
            >
              ›
            </button>
          </div>

          {result.install && (
            <div className="mt-2">
              <div className="text-[10px] text-slate-400">to install</div>
              <pre className="bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-emerald-300 overflow-auto whitespace-pre-wrap">
                {result.install.join('\n')}
              </pre>
            </div>
          )}
        </section>
      )}

      {(formats?.pitfalls ?? []).length > 0 && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> What goes wrong
          </h3>
          <div className="mt-2 space-y-1.5">
            {formats.pitfalls.map((p: any, i: number) => (
              <div key={i} className="border border-[#1e293b] rounded p-2 bg-[#0b1220]">
                <div className="text-[10px] text-rose-300">{p.symptom}</div>
                <div className="text-[10px] text-slate-400">cause: {p.cause}</div>
                <div className="text-[10px] text-emerald-300">fix: {p.fix}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outputs.length > 0 && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white">Generated so far</h3>
          <div className="mt-1.5 space-y-1">
            {outputs.slice(0, 8).map((o) => (
              <div key={o.name} className="flex items-center justify-between text-[10px] border border-[#1e293b] rounded px-2 py-1 bg-[#0b1220]">
                <span className="font-mono text-slate-400 truncate">{o.name}</span>
                <span className="text-slate-500 shrink-0">
                  {o.kind}
                  {o.bytes ? ` · ${(o.bytes / 1024).toFixed(0)} KB` : ` · ${o.files} files`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="text-[10px] text-slate-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        {formats?.note ?? 'Frames are painted locally — no image tools required.'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivity: number;
  running: boolean;
  detached: boolean;
  clientCount: number;
  buffered: number;
  limits: { idleMinutes: number; maxHours: number; maxScrollbackKB: number };
}

/**
 * A real shell, in a real terminal emulator.
 *
 * xterm.js is used rather than a <pre> because a shell sends escape sequences —
 * colours, cursor moves, line clearing. Printed to a <pre> those are visible
 * garbage; the emulator is what makes `htop` or a progress bar legible.
 *
 * The session list is always on screen. A shell that runs unseen is a process
 * nobody can stop, and the whole point of the limits is that they are visible
 * before they fire.
 */
function TerminalPanel({ plugin }: { plugin: Plugin }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cwd, setCwd] = useState('/home/ubuntu/project');
  const [limits, setLimits] = useState<any>(null);
  // Three tabs, one panel: the shell, the assistant, and the VM both of them
  // depend on. Kept as a tab rather than a modal because configuring an endpoint
  // is something you return to, and a modal loses that state when it closes.
  const [tab, setTab] = useState<'shell' | 'assistant' | 'connect' | 'vm'>('shell');

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const d = await api(`${plugin.endpointBase}/sessions`);
      setSessions(d.sessions ?? []);
      setLimits(d.limits ?? null);
      return d.sessions ?? [];
    } catch (e: any) {
      setError(e.message ?? String(e));
      return [];
    }
  }, [plugin.endpointBase]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(
    async (id?: string) => {
      setBusy(true);
      setError(null);
      try {
        if (!id) {
          const d = await api(`${plugin.endpointBase}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd }),
          });
          await loadSessions();
          if (d.session?.id) setActiveId(d.session.id);
        } else {
          setActiveId(id);
        }
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setBusy(false);
      }
    },
    [cwd, loadSessions, plugin.endpointBase],
  );

  const endSession = useCallback(
    async (id: string) => {
      try {
        await api(`${plugin.endpointBase}/sessions/${id}`, { method: 'DELETE' });
        await loadSessions();
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    },
    [loadSessions, plugin.endpointBase],
  );

  const removeSession = useCallback(
    async (id: string) => {
      try {
        wsRef.current?.close();
        wsRef.current = null;
        await api(`${plugin.endpointBase}/sessions/${id}/clear`, { method: 'POST' });
        if (activeId === id) setActiveId(null);
        await loadSessions();
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    },
    [activeId, loadSessions, plugin.endpointBase],
  );

  // ---- xterm wiring ------------------------------------------------------
  // The terminal is created once and reused; the socket is per session. Doing it
  // the other way round leaks a renderer per click.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      if (!hostRef.current) return;
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !hostRef.current) return;

      // CSS has to come from the package, not the app: this is a plugin host, so
      // the stylesheet belongs to the terminal component.
      if (!document.getElementById('xterm-css')) {
        const link = document.createElement('link');
        link.id = 'xterm-css';
        link.rel = 'stylesheet';
        link.href = '/node_modules/@xterm/xterm/css/xterm.css';
        document.head.appendChild(link);
      }

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: {
          background: '#0b1220',
          foreground: '#e2e8f0',
          cursor: '#22d3ee',
          selectionBackground: '#1e3a5f',
        },
        scrollback: 5000,
        convertEol: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;
      fitRef.current = fit;
      try {
        fit.fit();
      } catch {
        /* host not laid out yet */
      }

      ro = new ResizeObserver(() => {
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          if (dims && wsRef.current?.readyState === 1) {
            // A PTY cannot infer size; every full-screen tool depends on this.
            wsRef.current.send(
              '\u0000' + JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }),
            );
          }
        } catch {
          /* not visible */
        }
      });
      ro.observe(hostRef.current);

      // A plugin panel can be re-rendered away; the terminal must not keep
      // writing into a detached node.
      term.onData((data) => {
        if (wsRef.current?.readyState === 1) wsRef.current.send(data);
      });
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      try {
        termRef.current?.dispose();
      } catch {
        /* already gone */
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // ---- socket per active session ----------------------------------------
  useEffect(() => {
    const term = termRef.current;
    if (!term || !activeId) return;

    wsRef.current?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${plugin.endpointBase}/ws?session=${encodeURIComponent(activeId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      const dims = fitRef.current?.proposeDimensions?.();
      if (dims) ws.send('\u0000' + JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    };
    ws.onmessage = (ev) => {
      // Control frames are JSON; everything else is terminal bytes.
      if (typeof ev.data === 'string' && ev.data.startsWith('{')) {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'error') setError(msg.error);
          if (msg.type === 'hello') loadSessions();
          return;
        } catch {
          /* it was terminal text that happened to start with { */
        }
      }
      term.write(typeof ev.data === 'string' ? ev.data : '');
    };
    ws.onclose = () => {
      // Only meaningful if this is still the current socket.
      if (wsRef.current === ws) term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
    };

    return () => {
      ws.close();
    };
  }, [activeId, loadSessions, plugin.endpointBase]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const running = sessions.filter((s) => s.running).length;

  /**
   * Recent terminal text, for the assistant.
   *
   * Read from the emulator's buffer rather than from the PTY: the buffer holds
   * exactly what the user is looking at, including output that scrolled, and it
   * is already the resolved form of every escape sequence.
   */
  const recentOutput = useCallback(() => {
    const term = termRef.current;
    if (!term) return '';
    const buf = term.buffer?.active;
    if (!buf) return '';
    const lines: string[] = [];
    const start = Math.max(0, buf.length - 120);
    for (let i = start; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n').trim();
  }, []);

  const TABS: { id: typeof tab; label: string; icon: React.ReactNode }[] = [
    { id: 'shell', label: 'Shell', icon: <Terminal className="w-3 h-3" /> },
    { id: 'assistant', label: 'Assistant', icon: <Sparkles className="w-3 h-3" /> },
    { id: 'connect', label: 'Connect', icon: <Network className="w-3 h-3" /> },
    { id: 'vm', label: 'Settings', icon: <Server className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 border-b border-[#1e293b] pb-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-t border-b-2 -mb-[7px] ${
              tab === t.id
                ? 'border-emerald-500 text-white bg-[#0f172a]'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === 'shell' && running > 0 && (
              <span className="text-[9px] text-emerald-400">{running}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'assistant' && <AssistantPanel base={plugin.endpointBase} getContext={recentOutput} />}
      {tab === 'connect' && (
        <ConnectRouterPanel base={plugin.endpointBase} onOpenSettings={() => setTab('vm')} />
      )}
      {tab === 'vm' && <VmSettingsPanel base={plugin.endpointBase} />}

      {tab === 'shell' && (
      <div className="space-y-3">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">✕</button>
        </div>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" /> Sessions
              <span className="text-slate-500 font-normal">
                ({running} running{limits ? ` of ${limits.maxSessions}` : ''})
              </span>
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              A real shell with a tty, not a command runner. Each session closes itself after{' '}
              {limits?.idleMinutes ?? 30} min idle or {limits?.maxHours ?? 8} h total.
            </p>
          </div>
          <div className="flex items-end gap-1.5">
            <label className="text-[10px] text-slate-400 flex flex-col gap-0.5">
              cwd
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                className="w-56 bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
              />
            </label>
            <button
              onClick={() => openSession()}
              disabled={busy}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-bold px-3 py-2 rounded"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              New shell
            </button>
          </div>
        </div>

        {sessions.length > 0 && (
          <div className="mt-2 space-y-1">
            {sessions.map((s) => {
              const on = s.id === activeId;
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 border ${
                    on ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[#1e293b] bg-[#0b1220]'
                  }`}
                >
                  <button onClick={() => openSession(s.id)} className="min-w-0 flex items-center gap-2 flex-wrap text-left">
                    <span className="text-[10px] font-mono text-slate-300">{s.id}</span>
                    <span className="text-[10px] font-mono text-slate-500 truncate max-w-[16rem]">{s.cwd}</span>
                    <span
                      className={`text-[9px] ${s.running ? 'text-emerald-300' : 'text-slate-500'}`}
                    >
                      {s.running ? 'running' : 'exited'}
                    </span>
                    {s.detached && s.running && <span className="text-[9px] text-amber-300">no viewer</span>}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <span className="text-[9px] text-slate-500">
                      {Math.round(s.buffered / 1024)} KB
                    </span>
                    <button
                      onClick={() => endSession(s.id)}
                      disabled={!s.running}
                      className="text-[9px] px-1.5 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      kill
                    </button>
                    <button
                      onClick={() => removeSession(s.id)}
                      className="text-slate-600 hover:text-rose-400 px-0.5"
                      title="end and drop the transcript"
                    >
                      <XCircle className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="border border-[#1e293b] bg-[#0b1220] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e293b] bg-[#0f172a]">
          <div className="text-[10px] text-slate-400 font-mono">
            {active ? `${active.id} · ${active.shell}` : 'no session attached'}
          </div>
          {active && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500">
                {active.cols}×{active.rows}
              </span>
              <button
                onClick={() => {
                  if (wsRef.current?.readyState === 1) wsRef.current.send('\u0000' + JSON.stringify({ type: 'signal' }));
                }}
                className="text-[9px] px-1.5 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-white"
                title="send Ctrl-C"
              >
                ^C
              </button>
            </div>
          )}
        </div>
        <div ref={hostRef} className="h-[26rem] w-full p-1" />
      </section>

      {!active && (
        <div className="text-[10px] text-slate-500 flex items-start gap-1.5">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          New shell opens a login shell in the directory above. Output is replayed when you reattach, and the
          transcript stays readable after a shell exits.
        </div>
      )}
      </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pipeline plugin                                                     */
/* ------------------------------------------------------------------ */

interface PipelineStage {
  id: string;
  title: string;
  why: string;
  command: string;
  check: string;
  checkMeans: string;
  mutates: boolean;
}

interface PipelineLine {
  id: string;
  label: string;
  branch: string;
  upstream: string;
  expectedVersion: string;
  cmakeArgs: string[];
  runtimeDeps: string[];
  dependencyCount: Record<string, number>;
}

interface PipelineData {
  lines: PipelineLine[];
  stages: PipelineStage[];
  dependencies: Record<string, string[]> | null;
  runtimeFacts: string[];
  pitfalls: Array<{ id: string; symptom: string; cause: string; fix: string }>;
  note: string;
}

/**
 * A pipeline plugin: choose a line, get ordered stages.
 *
 * The point of the line picker is that these builds genuinely conflict — one
 * dep set per line, not a union — so the stages are re-fetched whenever the
 * choice changes rather than filtered on the client.
 */
function PipelinePanel({ plugin }: { plugin: Plugin }) {
  const base = plugin.endpointBase;
  const [line, setLine] = useState<string>('');
  const [distro, setDistro] = useState('debian');
  const [data, setData] = useState<PipelineData | null>(null);
  const [detect, setDetect] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api(`${base}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: line || undefined, distro }),
      });
      setData(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [base, line, distro]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api(`${base}/detect`)
      .then(setDetect)
      .catch(() => setDetect(null));
  }, [base]);

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* line + distro */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h3 className="text-xs font-bold text-white flex items-center gap-2">
          <Workflow className="w-3.5 h-3.5 text-cyan-400" /> Source line
        </h3>
        <p className="text-[11px] text-slate-400 mt-0.5">
          These two lines are not interchangeable. Picking the one that does not match the target's KDE fails at
          cmake, or worse, links and then breaks at runtime.
        </p>

        {detect && (
          <div
            className={`mt-2 text-[10px] rounded p-2 border flex items-start gap-1.5 ${
              detect.verdict === 'unknown' || detect.verdict === 'ambiguous'
                ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
            }`}
          >
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">detected: {detect.verdict}</div>
              <div className="text-slate-400">{detect.why}</div>
              <div className="text-slate-500 font-mono mt-0.5">
                cmake {detect.tools.cmake ? '✓' : '✗'} · fusermount3 {detect.tools.fuse3 ? '✓' : '✗'}
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {(data?.lines ?? []).map((l) => {
            const active = line === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setLine(l.id)}
                className={`text-left border rounded-lg p-2.5 transition-colors ${
                  active ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-[#1e293b] bg-[#0b1220] hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white">{l.label}</span>
                  {active && <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />}
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">branch {l.branch}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {l.dependencyCount.debian} debian · {l.dependencyCount.fedora} fedora · {l.dependencyCount.arch} arch
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-slate-400 flex items-center gap-1.5">
            distro
            <select
              value={distro}
              onChange={(e) => setDistro(e.target.value)}
              className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="debian">debian / ubuntu</option>
              <option value="fedora">fedora</option>
              <option value="arch">arch</option>
            </select>
          </label>
          {!line && <span className="text-[10px] text-amber-300">pick a line to see the exact commands</span>}
        </div>
      </section>

      {/* stages */}
      {line && data && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" /> Pipeline ({data.stages.length} stages)
          </h3>
          <div className="mt-2 space-y-1.5">
            {data.stages.map((st, i) => {
              const open = openStage === st.id;
              return (
                <div key={st.id} className="border border-[#1e293b] rounded-lg bg-[#0b1220]">
                  <button
                    onClick={() => setOpenStage(open ? null : st.id)}
                    className="w-full flex items-start gap-2 p-2.5 text-left"
                  >
                    <span className="text-[9px] font-mono text-slate-500 mt-0.5 shrink-0 w-4">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-white">{st.title}</span>
                        {st.mutates && (
                          <span className="text-[9px] px-1 rounded border border-amber-500/30 text-amber-300">
                            changes the system
                          </span>
                        )}
                      </div>
                      {!open && (
                        <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">{st.command}</div>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0">{open ? '−' : '+'}</span>
                  </button>

                  {open && (
                    <div className="px-2.5 pb-2.5 space-y-1.5">
                      <p className="text-[10px] text-slate-400 leading-relaxed">{st.why}</p>
                      <div className="relative">
                        <pre className="bg-[#0f172a] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-cyan-200 overflow-auto whitespace-pre-wrap">
                          {st.command}
                        </pre>
                        <button
                          onClick={() => copy(st.command, st.id)}
                          className="absolute top-1 right-1 text-[9px] text-slate-500 hover:text-white px-1.5 py-0.5 rounded border border-[#1e293b] bg-[#0b1220]"
                        >
                          {copied === st.id ? 'copied' : 'copy'}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        <span className="text-emerald-300">passes when</span>{' '}
                        <span className="font-mono text-slate-400">{st.check}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">{st.checkMeans}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 flex items-start gap-1.5">
            <Info className="w-3 h-3 shrink-0 mt-0.5" /> {data.note}
          </div>
        </section>
      )}

      {/* pitfalls */}
      {data && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> What actually goes wrong
          </h3>
          <div className="mt-2 space-y-1.5">
            {data.pitfalls.map((p) => (
              <div key={p.id} className="border border-[#1e293b] rounded-lg p-2 bg-[#0b1220]">
                <div className="text-[10px] font-mono text-rose-300 break-words">{p.symptom}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">cause: {p.cause}</div>
                <div className="text-[10px] text-emerald-300 mt-0.5">fix: {p.fix}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* runtime facts */}
      {data && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-slate-400" /> At runtime
          </h3>
          <ul className="mt-1.5 space-y-1">
            {data.runtimeFacts.map((f, i) => (
              <li key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                <span className="text-slate-600 mt-0.5">·</span> {f}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* APK Studio                                                          */
/* ------------------------------------------------------------------ */

/**
 * Make an APK, and be honest about what happened.
 *
 * The panel leads with whether the toolchain is complete, because a build button
 * that fails at step three is worse than knowing up front that the dexer is
 * missing. After a build it shows every step with its own result, so a failure
 * names the step rather than saying "build failed".
 *
 * The finished APK reports its package name, version and signing certificates as
 * read back from the file itself — not as we intended to write them.
 */
function ApkStudio({ plugin }: { plugin: Plugin }) {
  const base = plugin.endpointBase;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [build, setBuild] = useState<any>(null);
  const [form, setForm] = useState({ packageName: 'local.anyrealm.app', appName: 'AnyRealm App', minSdk: 21, targetSdk: 33 });
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`${base}/catalog`));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      setError(null);
      try {
        await fn();
        await load();
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const tools = data?.toolchain?.tools ?? {};
  const missing = Object.entries(tools)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">✕</button>
        </div>
      )}

      {/* toolchain state first: a build button that cannot work is a trap */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-emerald-400" /> Toolchain
        </h3>
        {data?.ready ? (
          <div className="mt-1 text-[10px] text-emerald-300">complete — every step in the pipeline can run</div>
        ) : (
          <div className="mt-1 text-[10px] text-amber-300">
            not complete{missing.length ? `: missing ${missing.join(', ')}` : ''}
            {data && !data.toolchain?.dexer ? ' · no dexer (R8/D8 jar) found' : ''}
          </div>
        )}
        <div className="mt-1.5 grid grid-cols-2 md:grid-cols-4 gap-1">
          {Object.entries(tools).map(([k, v]: any) => (
            <div key={k} className="text-[9px] flex items-center gap-1">
              <span className={`w-1 h-1 rounded-full ${v ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span className="text-slate-400">{k}</span>
            </div>
          ))}
          <div className="text-[9px] flex items-center gap-1">
            <span className={`w-1 h-1 rounded-full ${data?.toolchain?.dexer ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-slate-400">dexer</span>
          </div>
        </div>
        {data?.toolchain?.androidJar && (
          <div className="mt-1 text-[9px] text-slate-500 font-mono truncate">{data.toolchain.androidJar}</div>
        )}
      </section>

      {/* create */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-cyan-400" /> New app
        </h3>
        <div className="mt-1.5 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            package name
            <input
              value={form.packageName}
              onChange={(e) => setForm({ ...form, packageName: e.target.value })}
              className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1 text-[11px] text-slate-200 font-mono"
              placeholder="local.anyrealm.app"
            />
          </label>
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            label on the phone
            <input
              value={form.appName}
              onChange={(e) => setForm({ ...form, appName: e.target.value })}
              className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1 text-[11px] text-slate-200"
            />
          </label>
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            min SDK
            <input
              type="number"
              value={form.minSdk}
              onChange={(e) => setForm({ ...form, minSdk: Number(e.target.value) })}
              className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1 text-[11px] text-slate-200 font-mono"
            />
          </label>
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            target SDK
            <input
              type="number"
              value={form.targetSdk}
              onChange={(e) => setForm({ ...form, targetSdk: Number(e.target.value) })}
              className="bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1 text-[11px] text-slate-200 font-mono"
            />
          </label>
        </div>
        <button
          onClick={() =>
            act('create', async () => {
              const r = await api(`${base}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
              });
              setSelected(r.project.id);
            })
          }
          disabled={busy === 'create' || !data?.ready}
          className="mt-2 w-full flex items-center justify-center gap-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-[11px] font-bold px-3 py-2 rounded"
        >
          {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
          Create a starter app
        </button>
        <div className="mt-1 text-[9px] text-slate-500">
          A working WebView app with bundled HTML: it builds and installs as it is, then you replace the page.
        </div>
      </section>

      {/* project list */}
      {(data?.projects ?? []).length > 0 && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
          <h3 className="text-xs font-bold text-white">Projects</h3>
          <div className="mt-1.5 space-y-1">
            {data.projects.map((p: any) => (
              <div
                key={p.id}
                className={`rounded border px-2 py-1.5 ${selected === p.id ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-[#1e293b] bg-[#0b1220]'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => setSelected(p.id)} className="min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-white">{p.appName}</span>
                      <span className="text-[9px] font-mono text-slate-500">{p.packageName}</span>
                    </div>
                    <div className="text-[9px] text-slate-500">
                      API {p.minSdk}–{p.targetSdk}
                      {p.lastBuild
                        ? p.lastBuild.ok
                          ? ` · last build signed, ${(p.lastBuild.apk.size / 1024).toFixed(0)} KB`
                          : ` · last build failed at ${p.lastBuild.failedStep}`
                        : ' · never built'}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() =>
                        act(`build-${p.id}`, async () => {
                          setSelected(p.id);
                          try {
                            const r = await api(`${base}/projects/${p.id}/build`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({}),
                            });
                            setBuild({ id: p.id, ...r });
                          } catch (e: any) {
                            // A failed build carries its steps in the body; the
                            // api() helper only surfaces `error`, so fetch again.
                            setBuild({ id: p.id, ok: false, error: e.message });
                            throw e;
                          }
                        })
                      }
                      disabled={busy === `build-${p.id}` || !data?.ready}
                      className="text-[10px] px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:text-white disabled:opacity-30"
                    >
                      {busy === `build-${p.id}` ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <Play className="w-3 h-3 inline" />} build
                    </button>
                    {p.lastBuild?.ok && (
                      <a
                        href={`${base}/projects/${p.id}/download`}
                        className="text-[10px] px-2 py-1 rounded border border-violet-500/40 text-violet-300 hover:text-white"
                      >
                        <Download className="w-3 h-3 inline" /> apk
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* build result: every step, including the ones that passed */}
      {build && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
          <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
            {build.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
            {build.ok ? 'Built and signed' : 'Build stopped'}
          </h3>

          {build.apk && (
            <div className="mt-1.5 grid grid-cols-2 gap-1 text-[10px]">
              <div className="text-slate-500">package</div>
              <div className="font-mono text-slate-200 truncate">{build.apk.packageName}</div>
              <div className="text-slate-500">version</div>
              <div className="font-mono text-slate-200">
                {build.apk.versionName} ({build.apk.versionCode})
              </div>
              <div className="text-slate-500">size</div>
              <div className="font-mono text-slate-200">{(build.apk.size / 1024).toFixed(1)} KB</div>
              <div className="text-slate-500">signature</div>
              <div className="font-mono text-slate-200">
                {Object.entries(build.apk.schemes ?? {})
                  .filter(([, v]) => v)
                  .map(([k]) => `v${k}`)
                  .join(', ') || 'none'}
              </div>
              <div className="text-slate-500">cert sha-256</div>
              <div className="font-mono text-slate-300 truncate" title={build.apk.certSha256 ?? ''}>
                {build.apk.certSha256 ?? '—'}
              </div>
            </div>
          )}

          <div className="mt-2 space-y-0.5">
            {(build.steps ?? []).map((st: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px]">
                <span className={`mt-1 w-1 h-1 rounded-full shrink-0 ${st.ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="text-slate-300 w-36 shrink-0">{st.name}</span>
                <span className={`font-mono flex-1 ${st.ok ? 'text-slate-500' : 'text-rose-300'}`}>{st.detail}</span>
              </div>
            ))}
          </div>

          {build.apk && (
            <a
              href={`${base}/projects/${build.id}/download`}
              className="mt-2 w-full flex items-center justify-center gap-1.5 bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold px-3 py-2 rounded"
            >
              <Download className="w-3.5 h-3.5" /> Download {build.id}.apk
            </a>
          )}
          {build.error && <div className="mt-1.5 text-[10px] text-rose-300">{build.error}</div>}
        </section>
      )}
    </div>
  );
}

/* Generic fallback                                                    */
/* ------------------------------------------------------------------ */

function GenericPluginPanel({ plugin }: { plugin: Plugin }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const panel = plugin.panels[0];
    const target = panel?.endpoint ? `${plugin.endpointBase}${panel.endpoint}` : `${plugin.endpointBase}/catalog`;
    api(target)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [plugin]);

  return (
    <div className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
      <p className="text-[11px] text-slate-400 mb-2">
        This addon has no dedicated view yet. Its data is shown verbatim, so a new plugin is usable the
        moment it mounts.
      </p>
      {error && <div className="text-[11px] text-rose-300">{error}</div>}
      {data && (
        <pre className="bg-[#0b1220] border border-[#1e293b] rounded p-2 text-[10px] font-mono text-slate-300 overflow-auto max-h-[32rem]">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

export function usePlugins() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api('/api/plugins')
      .then((d) => setPlugins(d.plugins ?? []))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  return { plugins, loading, error };
}

export default function PluginHost({ pluginId }: PluginHostProps) {
  const { plugins, loading, error } = usePlugins();

  const plugin = useMemo(() => plugins.find((p) => p.id === pluginId), [plugins, pluginId]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-10 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading addons…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-rose-300 p-6">Could not read the plugin list: {error}</div>;
  }
  if (!plugin) {
    return <div className="text-sm text-slate-400 p-6">No plugin with id "{pluginId}" is installed.</div>;
  }

  return (
    <div className="space-y-4">
      <Banner plugin={plugin} />
      {plugin.healthy ? (
        // A pipeline plugin describes its stages as data. Rendering it here means
        // the next pipeline (a bootloader, a rootfs step, anything with ordered
        // commands) needs no change to this file.
        plugin.kind === 'pipeline' ? (
          <PipelinePanel plugin={plugin} />
        ) : plugin.id === 'boot-splash-lab' ? (
          <BootSplashPanel plugin={plugin} />
        ) : plugin.id === 'terminal-lab' ? (
          <TerminalPanel plugin={plugin} />
        ) : plugin.id === 'module-lab' ? (
          <ModuleLab plugin={plugin} />
        ) : plugin.id === 'recovery-lab' ? (
          <RecoveryLab plugin={plugin} />
        ) : plugin.id === 'lowlevel-lab' ? (
          <LowLevelLab plugin={plugin} />
        ) : plugin.id === 'apk-studio' ? (
          <ApkStudio plugin={plugin} />
        ) : (
          <GenericPluginPanel plugin={plugin} />
        )
      ) : (
        <div className="border border-rose-500/25 bg-rose-500/5 rounded-xl p-4 text-xs text-rose-200">
          This addon is installed but its backend did not mount, so there is nothing to drive. The error above
          is the whole story.
        </div>
      )}
    </div>
  );
}
