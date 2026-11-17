import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitFork, Layers, Server, Terminal, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

/**
 * The build chain picker.
 *
 * Five steps, one value each, in build order: Android base ROM, mobile Linux
 * distro, display server, shell/theme/packages, then the device kernel with its
 * root manager and the firmware fusion.
 *
 * The important behaviour is the narrowing: the distro slot decides which UX
 * options exist at all. That is not a UI nicety -- a UX installed from the wrong
 * distro produces a session with no binaries behind it, which builds fine and
 * boots to a black screen.
 */

type Edition = 'rom' | 'desktop_iso' | 'mobile_kernel';

interface UxOption {
  id: string;
  name: string;
  mechanism: string;
  kind: string;
  repo: string;
  branch: string;
  blurb: string;
  warning?: string;
  blocked?: string;
  defaultFor?: string[];
}

interface UxSlot {
  id: string;
  label: string;
  meaning: string;
  required: boolean;
  selected: string | null;
  options: UxOption[];
}

interface RootManager {
  id: string;
  name: string;
  dir: string;
  patches: string[];
  keys: string;
  note: string;
}

interface ConfigNeed {
  key: string;
  value: string;
  because: string;
  why: string;
}

interface ChainPlan {
  ok: boolean;
  roman: string | null;
  distro: string | null;
  displayOwner: string | null;
  rootManager: string;
  config: { needs: ConfigNeed[]; fragment: string };
  fusion: any;
  problems: string[];
  stages: Array<{ n: number; name: string; produces: string }>;
  summary: string;
}

const EDITIONS: Array<{ id: Edition; label: string }> = [
  { id: 'mobile_kernel', label: 'mobile (arm64 kernel)' },
  { id: 'desktop_iso', label: 'desktop (x86_64 ISO)' },
  { id: 'rom', label: 'ROM (source build)' },
];

export default function BuildChainPicker() {
  const [edition, setEdition] = useState<Edition>('mobile_kernel');
  const [slots, setSlots] = useState<UxSlot[]>([]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [rootManager, setRootManager] = useState('kernelsu-next');
  const [plan, setPlan] = useState<ChainPlan | null>(null);
  const [firmware, setFirmware] = useState<Array<{ name: string; file: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFragment, setShowFragment] = useState(false);
  const [rootManagers, setRootManagers] = useState<RootManager[]>([]);

  const loadSlots = useCallback(async () => {
    const q = new URLSearchParams({ edition });
    for (const [k, v] of Object.entries(selection)) if (v) q.set(k, String(v));
    const r = await fetch(`/api/chain/slots?${q}`);
    if (!r.ok) throw new Error(`slots: ${r.status}`);
    const d = await r.json();
    setSlots(d.slots);
    // Seed the selection from whatever the server considers current, so the plan
    // request always names every slot explicitly rather than relying on defaults.
    // Deliberately NOT seeded from s.selected: the chain is walked step by step,
    // so nothing is chosen until the user chooses it.
  }, [edition, selection]);

  useEffect(() => {
    loadSlots().catch((e) => setErr(e.message));
    // Deliberately re-run on edition and picks: the distro changes the option list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edition, selection.distro, selection.base_rom]);

  const planNow = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/chain/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edition, selection, rootManager, firmware }),
      });
      if (!r.ok) throw new Error(`plan: ${r.status}`);
      const d = await r.json();
      setPlan(d.plan);
      setSlots(d.slots);
      if (Array.isArray(d.rootManagers)) setRootManagers(d.rootManagers);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [edition, selection, rootManager, firmware]);

  const pick = (slotId: string, value: string) => {
    setSelection((prev) => {
      const next = { ...prev, [slotId]: value };
      // Changing the distro invalidates anything chosen from the old one.
      if (slotId === 'distro') {
        for (const k of ['display_owner', 'shell', 'theme', 'packages']) delete next[k];
      }
      return next;
    });
    setPlan(null);
  };

  const byId = useMemo(() => {
    const m = new Map<string, UxSlot>();
    for (const s of slots) m.set(s.id, s);
    return m;
  }, [slots]);

  const slot = (id: string) => byId.get(id);

  return (
    <div className="space-y-4" id="build-chain-picker">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <GitFork className="w-4 h-4 text-sky-400" />
            Build chain
          </h2>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">
            One choice per step, in build order. The Android ROM is always the base; the Linux
            distro is fused on top; the UX is picked from what that distro can install.
          </p>
        </div>
        <label className="text-[11px] text-slate-400 shrink-0">
          edition
          <select
            value={edition}
            onChange={(e) => {
              setEdition(e.target.value as Edition);
              setSelection({});
              setPlan(null);
            }}
            className="mt-1 block bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
          >
            {EDITIONS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* the five steps */}
      <div className="grid gap-2">
        {slots.map((s, i) => {
          const selected = selection[s.id] ?? '';
          // A step is locked until the step it depends on has been answered. The
          // dependency is real: the distro decides which UX options exist at all.
          const needsDistro = ['display_owner', 'shell', 'theme', 'packages'].includes(s.id);
          const locked = needsDistro && !selection.distro;
          const opt = s.options.find((o) => o.id === selected);
          const empty = s.options.length === 0;
          if (locked) {
            return (
              <div key={s.id} className="rounded border border-slate-800/50 bg-slate-900/20 p-2.5 opacity-50">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-700 w-4">{i + 1}</span>
                  <span className="text-[11px] font-semibold text-slate-500">{s.label}</span>
                  <span className="text-[10px] text-slate-600 ml-auto">choose a distro first</span>
                </div>
              </div>
            );
          }
          return (
            <div
              key={s.id}
              className={`rounded border p-2.5 ${
                empty
                  ? 'border-amber-900/60 bg-amber-950/20'
                  : selected
                    ? 'border-slate-800 bg-slate-900/40'
                    : 'border-slate-700 bg-slate-900/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-600 w-4">{i + 1}</span>
                <span className="text-[11px] font-semibold text-slate-300">{s.label}</span>
                {s.required && (
                  <span className="text-[9px] uppercase tracking-wide text-slate-600">required</span>
                )}
                {empty && (
                  <span className="text-[10px] text-amber-400 ml-auto flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> nothing available
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5 ml-6">{s.meaning}</p>

              {!empty && (
                <select
                  value={selected}
                  onChange={(e) => pick(s.id, e.target.value)}
                  className={`mt-1.5 ml-6 w-[calc(100%-1.5rem)] bg-slate-950 border rounded px-2 py-1.5 text-xs outline-none ${
                    selected
                      ? 'border-slate-800 text-slate-200'
                      : 'border-slate-700 text-slate-500'
                  }`}
                >
                  <option value="" disabled>
                    — choose {s.label} —
                  </option>
                  {s.options.map((o) => (
                    <option key={o.id} value={o.id} disabled={!!o.blocked}>
                      {o.name}
                      {o.blocked ? ` — ${o.blocked}` : ''}
                    </option>
                  ))}
                </select>
              )}

              {opt?.blurb && (
                <p className="text-[10px] text-slate-500 mt-1 ml-6 italic">{opt.blurb}</p>
              )}
              {opt?.warning && (
                <p className="text-[10px] text-amber-400/90 mt-1 ml-6 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                  {opt.warning}
                </p>
              )}
              {opt?.repo && !opt.repo.startsWith('anyrealm-builder') && (
                <p className="text-[9px] font-mono text-slate-600 mt-0.5 ml-6 truncate">
                  {opt.repo}
                  {opt.branch && opt.branch !== '(in tree)' ? ` @ ${opt.branch}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* root manager -- separate from the slots because it is a kernel feature, not a UI */}
      <div className="rounded border border-slate-800 bg-slate-900/40 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-600 w-4">6</span>
          <span className="text-[11px] font-semibold text-slate-300">root manager</span>
          <span className="text-[9px] uppercase tracking-wide text-slate-600">built into the kernel</span>
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5 ml-6">
          All four carry SUSFS and ZeroMount. They differ in their safety patch, which is what decides
          whether the adb filter and the NUKI source fixes are present.
        </p>
        <select
          value={rootManager}
          onChange={(e) => {
            setRootManager(e.target.value);
            setPlan(null);
          }}
          className="mt-1.5 ml-6 w-[calc(100%-1.5rem)] bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 outline-none"
        >
          {(rootManagers.length
            ? rootManagers
            : [{ id: 'kernelsu-next', name: 'KernelSU-Next' }].map((r) => ({ ...r, note: '', dir: '', patches: [], keys: '' }))
          ).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.id === 'kernelsu-next' ? ' (pinned, full series)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* firmware -- the input the fusion stage rebuilds from */}
      <div className="rounded border border-slate-800 bg-slate-900/40 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-600 w-4">7</span>
          <span className="text-[11px] font-semibold text-slate-300">uploaded firmware</span>
          <span className="text-[9px] uppercase tracking-wide text-slate-600">
            {firmware.length} image(s)
          </span>
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5 ml-6">
          Only <span className="font-mono">boot</span> and{' '}
          <span className="font-mono">vendor_dlkm</span> are rebuilt. Everything else is passed through
          byte for byte, which is why this does not need a fresh AOSP tree.
        </p>
        <div className="mt-1.5 ml-6 flex flex-wrap gap-1">
          {['boot', 'vendor_boot', 'dtbo', 'super', 'vendor_dlkm'].map((n) => {
            const on = firmware.some((f) => f.name === n);
            return (
              <button
                key={n}
                onClick={() =>
                  setFirmware((prev) =>
                    on
                      ? prev.filter((f) => f.name !== n)
                      : [...prev, { name: n, file: `${n}.img` }],
                  )
                }
                className={`px-2 py-1 rounded text-[10px] font-mono border cursor-pointer ${
                  on
                    ? 'border-sky-700 bg-sky-950/50 text-sky-300'
                    : 'border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={planNow}
          disabled={loading || !selection.base_rom || !selection.distro || !selection.display_owner}
          className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer flex items-center gap-1.5"
        >
          <Layers className="w-3.5 h-3.5" />
          {loading ? 'resolving…' : 'resolve chain'}
        </button>
        {(!selection.base_rom || !selection.distro || !selection.display_owner) && (
          <span className="text-[10px] text-slate-500">
            {!selection.base_rom
              ? 'step 1: choose the Android base'
              : !selection.distro
                ? 'step 2: choose the Linux distro'
                : 'step 3: choose the display server'}
          </span>
        )}
        {err && <span className="text-[11px] text-rose-400">{err}</span>}
      </div>

      {/* result */}
      {plan && (
        <div className="space-y-3 border-t border-slate-800 pt-3">
          <div
            className={`flex items-start gap-2 text-[11px] ${
              plan.ok ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {plan.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
            )}
            <span>{plan.summary}</span>
          </div>

          {plan.problems.length > 0 && (
            <ul className="space-y-1 ml-5">
              {plan.problems.map((p, i) => (
                <li key={i} className="text-[10px] text-rose-300 list-disc">
                  {p}
                </li>
              ))}
            </ul>
          )}

          {/* ordered stages */}
          <div className="rounded border border-slate-800 overflow-hidden">
            <div className="px-2 py-1.5 bg-slate-900/70 text-[10px] font-semibold text-slate-400 flex items-center gap-1.5">
              <Server className="w-3 h-3" /> stages
            </div>
            <table className="w-full text-[10px]">
              <tbody>
                {plan.stages.map((s) => (
                  <tr key={s.n} className="border-t border-slate-800/60">
                    <td className="px-2 py-1 font-mono text-slate-600 w-5">{s.n}</td>
                    <td className="px-1 py-1 text-slate-300 whitespace-nowrap">{s.name}</td>
                    <td className="px-2 py-1 text-slate-500 font-mono">{s.produces}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* derived config */}
          <div className="rounded border border-slate-800 overflow-hidden">
            <button
              onClick={() => setShowFragment((v) => !v)}
              className="w-full px-2 py-1.5 bg-slate-900/70 text-[10px] font-semibold text-slate-400 flex items-center gap-1.5 cursor-pointer hover:text-slate-200"
            >
              <Terminal className="w-3 h-3" />
              kernel config — {plan.config.needs.length} keys derived from these picks
              <span className="ml-auto text-slate-600">{showFragment ? 'hide' : 'show'}</span>
            </button>
            <div className="max-h-56 overflow-auto">
              {plan.config.needs.map((n) => (
                <div key={n.key} className="px-2 py-1 border-t border-slate-800/60">
                  <div className="font-mono text-[10px] text-slate-300">
                    {n.key}={n.value}
                    <span className="ml-2 text-[9px] text-slate-600">[{n.because}]</span>
                  </div>
                  <div className="text-[9px] text-slate-500">{n.why}</div>
                </div>
              ))}
            </div>
            {showFragment && (
              <pre className="px-2 py-1.5 border-t border-slate-800 bg-slate-950 text-[9px] font-mono text-slate-400 overflow-auto max-h-40">
                {plan.config.fragment}
              </pre>
            )}
          </div>

          {/* fusion plan */}
          {plan.fusion && (
            <div className="rounded border border-slate-800 overflow-hidden">
              <div className="px-2 py-1.5 bg-slate-900/70 text-[10px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Info className="w-3 h-3" /> firmware fusion
              </div>
              <table className="w-full text-[10px]">
                <tbody>
                  {(plan.fusion.partitions ?? []).map((p: any) => (
                    <tr key={p.name} className="border-t border-slate-800/60">
                      <td className="px-2 py-1 font-mono text-slate-300">{p.name}</td>
                      <td className="px-1 py-1">
                        <span
                          className={
                            p.rebuilt
                              ? 'text-amber-400'
                              : 'text-slate-500'
                          }
                        >
                          {p.rebuilt ? 'rebuilt' : 'passed through'}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-slate-500">{p.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
