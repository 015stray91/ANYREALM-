import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ChainPicker from './ChainPicker';
import type { ServerSlot } from './ChainPicker';
import {
  GitFork,
  Play,
  FileCode2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  UploadCloud,
  Lock,
} from 'lucide-react';

interface ForkBinding {
  key: string;
  owner: string;
  repo: string;
  ref: string;
  composed: boolean;
  composedAt?: string;
  workflowFile?: string;
  edition?: string;
  forkedFrom?: string;
  dispatchable: boolean;
  lastDispatch?: { at: string; ok: boolean; detail?: string; runUrl?: string };
}

interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  jobs?: number;
  steps?: number;
}

interface ComposeResult {
  fileName: string;
  yaml: string;
  validation: Validation;
  target: { owner: string; repo: string; ref?: string };
  committed?: boolean;
  path?: string;
  prUrl?: string;
  note?: string;
  binding?: ForkBinding;
  error?: string;
  errors?: string[];
}

type Edition = 'rom' | 'desktop_iso' | 'mobile_kernel';

interface CatalogSource {
  id: string;
  name: string;
  kind: string;
  url: string;
  arch?: string[];
}

const DE_OPTIONS = [
  { id: 'gnome', label: 'GNOME' },
  { id: 'plasma', label: 'KDE Plasma' },
  { id: 'xfce', label: 'Xfce (lightest)' },
  { id: 'cinnamon', label: 'Cinnamon' },
  { id: 'budgie', label: 'Budgie' },
  { id: 'sway', label: 'Sway (Wayland tiling)' },
];

export default function ComposeDispatch() {
  const [forks, setForks] = useState<ForkBinding[]>([]);
  const [tokenOk, setTokenOk] = useState(false);
  const [catalog, setCatalog] = useState<{ sources: CatalogSource[]; addons: CatalogSource[] }>({
    sources: [],
    addons: [],
  });

  const [owner, setOwner] = useState('015stray91');
  const [repo, setRepo] = useState('ANYREALM-');
  const [ref, setRef] = useState('main');

  const [edition, setEdition] = useState<Edition>('desktop_iso');
  const [romId, setRomId] = useState('lineageos');
  const [romX86Id, setRomX86Id] = useState('bliss-x86');
  const [distroId, setDistroId] = useState('debian-installer');
  const [kernelId, setKernelId] = useState('ar-nuki-genevn');
  const [overlayId, setOverlayId] = useState('kali-nethunter-pro');
  const [useOverlay, setUseOverlay] = useState(true);
  const [codename, setCodename] = useState('genevn');
  const [soc, setSoc] = useState('sm6450');
  const [arch, setArch] = useState<'arm64' | 'x86_64'>('arm64');
  const [desktopEnv, setDesktopEnv] = useState('xfce');
  const [extraPkgs, setExtraPkgs] = useState('firmware-linux network-manager');
  // One compiler slot per build stage. Empty means "use the host compiler", so
  // a user who does not care about toolchains gets a working build.
  const [chainSlots, setChainSlots] = useState<Record<string, ServerSlot | undefined>>({});
  const [addonTools, setAddonTools] = useState<string[]>([]);
  // Applies the dual-libc SENRFS policy delta and the boot mount. On by default
  // for anything carrying both bionic and glibc, because without it the fused
  // tree has no glibc domain and no ext4 mount point.
  const [nurfsPolicy, setNurfsPolicy] = useState(true);

  const [preview, setPreview] = useState<ComposeResult | null>(null);
  const [composing, setComposing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  const [createPr, setCreatePr] = useState(false);

  const loadForks = useCallback(async () => {
    try {
      const r = await fetch('/api/forks');
      const d = await r.json();
      setForks(d.forks ?? []);
      setTokenOk(!!d.tokenConfigured);
    } catch {
      setForks([]);
    }
  }, []);

  useEffect(() => {
    loadForks();
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setCatalog({ sources: d.sources ?? [], addons: d.addons ?? [] }))
      .catch(() => undefined);
  }, [loadForks]);

  const byKind = (kind: string) => catalog.sources.filter((s) => s.kind === kind);

  const spec = useMemo(() => {
    const find = (id: string) => catalog.sources.find((s) => s.id === id);
    const rom = find(romId);
    const distro = find(distroId);
    const kernel = find(kernelId);
    const overlay = find(overlayId);

    const base: any = {
      edition,
      device: { codename, soc, arch },
      desktop: { environment: desktopEnv, packages: extraPkgs.split(/\s+/).filter(Boolean) },
    };

    // Only send the stages that were actually chosen. The generator fills any
    // missing role from `userspace`, and an empty chain means "host compiler".
    const slots = Object.fromEntries(Object.entries(chainSlots).filter(([, v]) => !!v));
    if (Object.keys(slots).length > 0) {
      const first = Object.values(slots)[0] as ServerSlot;
      base.chain = {
        id: 'custom-per-stage',
        label: 'Custom per-stage chain',
        userspace: slots.system ?? slots.host ?? first,
        ...slots,
        // The generator re-derives this per role; sending it lets the UI gate
        // the build before it ever reaches the server.
        obfuscator: Object.values(slots).some((s) => (s as ServerSlot).obfuscator),
      };
    }
    if (addonTools.length > 0) base.tools = addonTools;
    if (nurfsPolicy) base.nurfsPolicy = true;
    if (edition === 'rom' && rom && kernel) {
      base.rom = { id: rom.id, name: rom.name, url: rom.url };
      base.kernel = { id: kernel.id, name: kernel.name, url: kernel.url };
    }
    if (edition === 'desktop_iso' && distro) {
      base.distro = { id: distro.id, name: distro.name, url: distro.url };
      // The desktop edition is Android-x86 + a Linux user space on x86_64, so
      // the Android half must come from an x86_64 tree. An arm64 ROM here would
      // compile fine and then not boot on the Vivobook.
      const romX86 = catalog.sources.find((s) => s.id === romX86Id);
      if (romX86) base.androidBase = { id: romX86.id, name: romX86.name, url: romX86.url };
      if (useOverlay && overlay) {
        base.overlay = { id: overlay.id, name: overlay.name, url: overlay.url };
      }
      if (kernel) base.kernel = { id: kernel.id, name: kernel.name, url: kernel.url };
    }
    if (edition === 'mobile_kernel' && kernel) {
      base.kernel = { id: kernel.id, name: kernel.name, url: kernel.url };
    }
    return base;
  }, [edition, romId, romX86Id, distroId, kernelId, overlayId, useOverlay, codename, soc, arch, desktopEnv, extraPkgs, catalog, chainSlots, addonTools, nurfsPolicy]);

  const compose = async () => {
    setComposing(true);
    setMessage(null);
    try {
      const r = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, target: { owner, repo, ref }, commit: false }),
      });
      const d: ComposeResult = await r.json();
      setPreview(d);
      if (d.error) setMessage({ kind: 'err', text: d.error });
      else if (!d.validation.ok) setMessage({ kind: 'err', text: 'generated workflow is invalid — see errors below' });
      else setMessage({ kind: 'ok', text: `composed ${d.fileName} — review it, then write it to the fork` });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setComposing(false);
    }
  };

  const commit = async () => {
    setCommitting(true);
    setMessage(null);
    try {
      const r = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, target: { owner, repo, ref }, commit: true, createPr }),
      });
      const d: ComposeResult = await r.json();
      if (d.error) {
        setMessage({ kind: 'err', text: d.error });
        setPreview((p) => (p ? { ...p, yaml: d.yaml ?? p.yaml, validation: d.validation ?? p.validation } : p));
      } else {
        setPreview(d);
        setMessage({
          kind: 'ok',
          text: d.prUrl ? `written to a branch — merge the PR to make it dispatchable: ${d.prUrl}` : d.note ?? 'written',
        });
        loadForks();
      }
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCommitting(false);
    }
  };

  const dispatch = async () => {
    setDispatching(true);
    setMessage(null);
    try {
      const r = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { owner, repo, ref } }),
      });
      const d = await r.json();
      if (d.error) setMessage({ kind: d.gated ? 'warn' : 'err', text: d.error });
      else setMessage({ kind: 'ok', text: `${d.workflowFile} dispatched — ${d.hint}` });
      loadForks();
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDispatching(false);
    }
  };

  const currentFork = forks.find((f) => f.owner.toLowerCase() === owner.toLowerCase() && f.repo.toLowerCase() === repo.toLowerCase());
  const isDispatchable = !!currentFork?.dispatchable;
  const canCommit = tokenOk;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <GitFork className="w-4 h-4 text-sky-400" />
          Compose &amp; Dispatch
        </h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Pick the sources, choose an edition, and this turns the form into a real
          GitHub Actions workflow file. It is written to the fork you name — that fork's
          own account and its own repo — and only then can it be dispatched. A fresh
          fork has no workflow, so the builder is the only way in.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${
            message.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : message.kind === 'warn'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : message.kind === 'warn' ? (
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          )}
          <span className="break-all">{message.text}</span>
        </div>
      )}

      {forks.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            known forks
          </div>
          <div className="flex flex-wrap gap-2">
            {forks.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setOwner(f.owner);
                  setRepo(f.repo);
                  setRef(f.ref);
                }}
                className={`px-2.5 py-1.5 rounded-md text-[11px] border flex items-center gap-1.5 cursor-pointer ${
                  f.key === currentFork?.key
                    ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                }`}
              >
                {f.dispatchable ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Lock className="w-3 h-3 text-amber-400" />
                )}
                {f.key}
                <span className="text-slate-500">{f.edition ?? '—'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* target */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            target fork
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-400">
              owner
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-sky-500 outline-none"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              repo
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-sky-500 outline-none"
              />
            </label>
          </div>
          <label className="text-[11px] text-slate-400 block">
            branch
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-sky-500 outline-none"
            />
          </label>
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1 ${isDispatchable ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isDispatchable ? <CheckCircle2 className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {isDispatchable ? 'composed here — dispatchable' : 'not composed yet — dispatch is blocked'}
            </span>
          </div>
          {!tokenOk && (
            <div className="text-[11px] text-amber-400/90 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              no GITHUB_TOKEN set: you can compose and read the workflow, but not write or dispatch it
            </div>
          )}
          <label className="flex items-center gap-2 text-[11px] text-slate-400 pt-1">
            <input type="checkbox" checked={createPr} onChange={(e) => setCreatePr(e.target.checked)} />
            write to a branch and open a pull request instead of pushing to {ref}
          </label>
        </div>

        {/* edition */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">edition</div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'rom', label: 'ROM', sub: 'flashable zip' },
                { id: 'desktop_iso', label: 'Desktop ISO', sub: 'NUKI/NURFS' },
                { id: 'mobile_kernel', label: 'Kernel', sub: 'boot image' },
              ] as const
            ).map((e) => (
              <button
                key={e.id}
                onClick={() => setEdition(e.id)}
                className={`px-2 py-2 rounded-md border text-left cursor-pointer ${
                  edition === e.id
                    ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-semibold">{e.label}</div>
                <div className="text-[10px] text-slate-500">{e.sub}</div>
              </button>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            {edition === 'rom' && (
              <label className="text-[11px] text-slate-400 block">
                ROM source
                <select
                  value={romId}
                  onChange={(e) => setRomId(e.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                >
                  {byKind('rom').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {edition === 'desktop_iso' && (
              <label className="text-[11px] text-slate-400 block">
                distro base
                <select
                  value={distroId}
                  onChange={(e) => setDistroId(e.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                >
                  {byKind('desktop_linux').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {edition !== 'desktop_iso' && (
              <label className="text-[11px] text-slate-400 block">
                kernel tree
                <select
                  value={kernelId}
                  onChange={(e) => setKernelId(e.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                >
                  {byKind('kernel').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {edition === 'desktop_iso' && (
              <>
                <label className="text-[11px] text-slate-400 block">
                  Android x86_64 base
                  <select
                    value={romX86Id}
                    onChange={(e) => setRomX86Id(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                  >
                    {byKind('rom_x86').map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-slate-400 block">
                  desktop environment (addon)
                  <select
                    value={desktopEnv}
                    onChange={(e) => setDesktopEnv(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                  >
                    {DE_OPTIONS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-slate-400 block">
                  extra packages
                  <input
                    value={extraPkgs}
                    onChange={(e) => setExtraPkgs(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <input type="checkbox" checked={useOverlay} onChange={(e) => setUseOverlay(e.target.checked)} />
                  layer a mobile Linux user space on top
                </label>
                {useOverlay && (
                  <select
                    value={overlayId}
                    onChange={(e) => setOverlayId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                  >
                    {byKind('mobile_linux').map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}

            {edition !== 'desktop_iso' && (
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[11px] text-slate-400">
                  codename
                  <input
                    value={codename}
                    onChange={(e) => setCodename(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono outline-none"
                  />
                </label>
                <label className="text-[11px] text-slate-400">
                  soc
                  <input
                    value={soc}
                    onChange={(e) => setSoc(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono outline-none"
                  />
                </label>
                <label className="text-[11px] text-slate-400">
                  arch
                  <select
                    value={arch}
                    onChange={(e) => setArch(e.target.value as 'arm64' | 'x86_64')}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
                  >
                    <option value="arm64">arm64</option>
                    <option value="x86_64">x86_64</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={nurfsPolicy}
          onChange={(e) => setNurfsPolicy(e.target.checked)}
          className="mt-0.5 accent-emerald-500"
        />
        <span>
          <span className="font-medium text-slate-100">Dual-libc policy + boot mount</span>
          <span className="block text-slate-500">
            Grants glibc its own SELinux domain, mounts the fused ext4 image before vold starts, and gives the
            compositor the display. Required when bionic and glibc share one image.
          </span>
        </span>
      </label>

      <div className="mt-4">
        <ChainPicker
          value={chainSlots}
          onChange={setChainSlots}
          tools={addonTools}
          onTools={setAddonTools}
          edition={edition}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={compose}
          disabled={composing}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-slate-950 px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer"
        >
          {composing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode2 className="w-4 h-4" />}
          {composing ? 'Composing…' : 'Compose workflow'}
        </button>
        <button
          onClick={commit}
          disabled={committing || !canCommit || !preview || !preview.validation.ok}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-slate-950 px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer"
        >
          {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          {committing ? 'Writing…' : `Write to ${owner}/${repo}`}
        </button>
        <button
          onClick={dispatch}
          disabled={dispatching || !isDispatchable}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-lg font-bold text-xs cursor-pointer"
          title={isDispatchable ? 'dispatch the composed workflow' : 'compose and write it to this fork first'}
        >
          {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Dispatch
        </button>
        <a
          href={`https://github.com/${owner}/${repo}/actions`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 px-4 py-2.5 rounded-lg font-semibold text-xs"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Actions tab
        </a>
      </div>

      {preview && (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-900/80 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-300 font-mono">
              .github/workflows/{preview.fileName}
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className={preview.validation.ok ? 'text-emerald-400' : 'text-rose-400'}>
                {preview.validation.ok ? 'valid' : 'invalid'}
              </span>
              <span className="text-slate-500">
                {preview.validation.jobs} job · {preview.validation.steps} steps
              </span>
            </div>
          </div>
          {preview.validation.errors.length > 0 && (
            <div className="px-4 py-2 border-t border-rose-500/30 bg-rose-500/10 space-y-1">
              {preview.validation.errors.map((e, i) => (
                <div key={i} className="text-[11px] text-rose-300">
                  {e}
                </div>
              ))}
            </div>
          )}
          {preview.validation.warnings.length > 0 && (
            <div className="px-4 py-2 border-t border-amber-500/30 bg-amber-500/10 space-y-1">
              {preview.validation.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-amber-300">
                  {w}
                </div>
              ))}
            </div>
          )}
          <pre className="px-4 py-3 text-[11px] leading-relaxed text-slate-300 font-mono max-h-[28rem] overflow-auto bg-slate-950/70">
            {preview.yaml}
          </pre>
        </div>
      )}
    </div>
  );
}
