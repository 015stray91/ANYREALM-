/**
 * Compile Router.
 *
 * Three decisions, in order: where a build runs, which runner on that site, and
 * for a remote, which *address* that runner is reached on right now.
 *
 * The last one is the part that matters day to day. A build box answers on
 * several addresses — LAN, public, a tunnel, a second port — and which one is
 * reachable changes with the network you are sitting on. So a remote keeps a
 * pool and names one active. Swapping is one click; the runner and the route are
 * untouched.
 *
 * Nothing here starts a build. Probes are read-only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Server,
  Cloud,
  Laptop,
  Plus,
  Trash2,
  Play,
  Save,
  Info,
  Clock,
  Network,
  ArrowRightLeft,
} from 'lucide-react';

interface TargetDef {
  id: 'local' | 'actions' | 'remote';
  label: string;
  summary: string;
  detail: string;
  bestFor: string;
  risks: string[];
}

interface RemoteEndpoint {
  id: string;
  label: string;
  user: string;
  host: string;
  port: number;
  identity?: string;
}

interface Runner {
  id: string;
  label: string;
  kind: 'local' | 'actions' | 'remote';
  host: string;
  endpoints?: RemoteEndpoint[];
  endpointId?: string | null;
  activeEndpoint?: RemoteEndpoint | null;
  address?: string;
  workDir: string;
  labels?: string[];
  notes?: string;
  cores?: number;
  ramGb?: number;
}

interface Route {
  target: 'local' | 'actions' | 'remote';
  runnerId: string | null;
  structure?: string;
  reason?: string;
  updatedAt?: string;
}

interface TemporaryRoute {
  route: Route;
  expiresAt: string;
  fallback: Route;
  note?: string;
}

interface EffectiveRoute extends Route {
  temporary: boolean;
  expiresAt?: string;
}

interface Probe {
  runnerId: string;
  endpointId: string | null;
  label: string;
  reachable: boolean;
  latencyMs: number | null;
  facts: string[];
  error?: string;
  command: string;
}

/**
 * The tab's field styling, in one place.
 *
 * These are the same tokens the Core Library and Partitions tabs use: same
 * background, same 1px border, same focus ring, same text size. Repeating them
 * per input is how a tab ends up with four subtly different field heights, so
 * every input/select in this file goes through one of these two constants.
 */
const FIELD =
  'bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50';
const FIELD_MONO = `${FIELD} font-mono`;
/** A labelled field: the label wraps the input so clicking the text focuses it. */
const LABEL = 'text-[10px] text-slate-400 flex flex-col gap-0.5';
const BTN = 'border border-[#1e293b] text-slate-400 hover:text-white text-[10px] px-2 py-1 rounded transition-colors';

const TARGET_ICON: Record<string, React.ReactNode> = {
  local: <Laptop className="w-4 h-4" />,
  actions: <Cloud className="w-4 h-4" />,
  remote: <Server className="w-4 h-4" />,
};

const EMPTY_ENDPOINT: Omit<RemoteEndpoint, 'id'> = {
  label: '',
  user: '',
  host: '',
  port: 22,
  identity: '',
};

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

const post = (path: string, body: unknown): Promise<any> =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * Temporary route: "send builds through this machine for the next N hours."
 *
 * The value is that it expires on its own. A VM booted for an afternoon is not a
 * lasting decision, and a builder that still points at it tomorrow fails every
 * build for a reason nobody remembers setting.
 */
function TemporaryPanel({
  runner,
  temporary,
  effective,
  nowMs,
  busy,
  onSet,
  onClear,
  onPromote,
}: {
  runner: Runner;
  temporary: TemporaryRoute | null;
  effective: EffectiveRoute;
  nowMs: number;
  busy: string | null;
  onSet: (target: string, runnerId: string, minutes: number, note: string) => Promise<void>;
  onClear: () => Promise<void>;
  onPromote: () => Promise<void>;
}) {
  const [minutes, setMinutes] = useState(120);
  const [note, setNote] = useState('');

  const mine = temporary && temporary.route.runnerId === runner.id;
  const live = !!mine && Date.parse(temporary!.expiresAt) > nowMs;
  const msLeft = mine ? Date.parse(temporary!.expiresAt) - nowMs : 0;
  const minsLeft = Math.max(0, Math.round(msLeft / 60_000));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Route the next builds through this machine only, then fall back to where builds normally go. The deadline is
        stored, so forgetting to revert cannot strand later builds on a host that has gone away.
      </p>

      {live ? (
        <div className="border border-cyan-500/40 bg-cyan-500/5 rounded p-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[11px] text-cyan-200 font-bold flex items-center gap-1">
                <Clock className="w-3 h-3" /> in force — {minsLeft > 0 ? `${minsLeft} min left` : 'expiring now'}
              </div>
              <div className="text-[10px] text-slate-400">
                expires {new Date(temporary!.expiresAt).toLocaleString()}
              </div>
              {temporary!.note && <div className="text-[10px] text-slate-500 italic">{temporary!.note}</div>}
              <div className="text-[10px] text-slate-500 mt-0.5">
                falls back to{' '}
                <span className="font-mono text-slate-300">
                  {temporary!.fallback.target}
                  {temporary!.fallback.runnerId ? `:${temporary!.fallback.runnerId}` : ''}
                </span>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={onPromote}
                disabled={busy !== null}
                className="text-[10px] px-2 py-1 rounded border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10"
              >
                make permanent
              </button>
              <button
                onClick={onClear}
                disabled={busy !== null}
                className="text-[10px] px-2 py-1 rounded border border-[#1e293b] text-slate-400 hover:text-white"
              >
                end now
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-1.5">
          <label className={LABEL + ' md:col-span-1'}>
            minutes
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className={FIELD + ' mt-0.5 w-full'}
            />
          </label>
          <label className={LABEL + ' md:col-span-3'}>
            note (why)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VM booted to test the ISO"
              className={FIELD + ' mt-0.5 w-full'}
            />
          </label>
          <button
            onClick={() => onSet('remote', runner.id, minutes, note)}
            disabled={busy !== null || (runner.endpoints ?? []).length === 0}
            className="md:col-span-4 flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[10px] font-bold px-3 py-1.5 rounded"
          >
            {busy === 'temporary' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Route builds here for {minutes} min
          </button>
          {(runner.endpoints ?? []).length === 0 && (
            <div className="md:col-span-4 text-[10px] text-rose-300">
              add an address first — a temporary route still needs somewhere to connect
            </div>
          )}
        </div>
      )}

      {!live && temporary && !mine && (
        <div className="text-[10px] text-amber-300 flex items-start gap-1">
          <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
          a temporary route is in force on{' '}
          <span className="font-mono">{temporary.route.runnerId ?? 'local'}</span> — starting one here replaces it
        </div>
      )}
      {effective.temporary && (
        <div className="text-[10px] text-slate-500">
          dispatch currently uses <span className="font-mono text-slate-300">{effective.target}:{effective.runnerId ?? '-'}</span>
        </div>
      )}
    </div>
  );
}

export default function CompileRouter() {
  const [targets, setTargets] = useState<TargetDef[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [route, setRoute] = useState<Route>({ target: 'local', runnerId: null });
  const [effective, setEffective] = useState<EffectiveRoute>({ target: 'local', runnerId: null, temporary: false });
  const [temporary, setTemporary] = useState<TemporaryRoute | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** Which panel is open per runner. Endpoints and the temporary route are separate concerns. */
  const [runnerTab, setRunnerTab] = useState<Record<string, 'addresses' | 'temporary'>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // runner creation
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<any>({
    kind: 'remote',
    label: '',
    labelsText: 'self-hosted, anyrealm-vm',
    workDir: '/mnt/anyrealm',
    endpoint: { ...EMPTY_ENDPOINT },
  });

  // endpoint editing, keyed by runner id
  const [showEndpointFor, setShowEndpointFor] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState<any>({ ...EMPTY_ENDPOINT });

  const probeKey = (runnerId: string, endpointId: string | null) => `${runnerId}::${endpointId ?? '-'}`;

  const load = useCallback(async () => {
    const d = await api('/api/routing');
    setTargets(d.targets ?? []);
    setRunners(d.runners ?? []);
    setRoute(d.route ?? { target: 'local', runnerId: null });
    setEffective(d.effective ?? { ...(d.route ?? { target: 'local', runnerId: null }), temporary: false });
    setTemporary(d.temporary ?? null);
    setWarnings(d.warnings ?? []);
  }, []);

  // The countdown has to tick, or a temporary route looks permanent until reload.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [load]);

  const chooseTarget = useCallback(async (target: TargetDef['id'], runnerId?: string | null) => {
    setBusy('route');
    setError(null);
    try {
      const d = await post('/api/routing/route', { target, runnerId: runnerId ?? null });
      setRoute(d.route);
      setWarnings(d.warnings ?? []);
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const probe = useCallback(async (id: string, endpointId?: string) => {
    const key = endpointId ? `probe:${id}:${endpointId}` : `probe:${id}`;
    setBusy(key);
    setError(null);
    try {
      const d = await post('/api/routing/probe', endpointId ? { id, endpointId } : { id });
      const map: Record<string, Probe> = {};
      for (const p of d.probes ?? []) map[probeKey(p.runnerId, p.endpointId)] = p;
      setProbes((prev) => ({ ...prev, ...map }));
      if (d.warnings) setWarnings(d.warnings);
      if (d.note) setError(d.note);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const saveRunner = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const body: any = {
        kind: draft.kind,
        label: draft.label,
        workDir: draft.workDir,
        notes: draft.notes,
        cores: draft.cores,
        ramGb: draft.ramGb,
      };
      if (draft.kind === 'remote') {
        const ep = draft.endpoint ?? {};
        // Only send an endpoint if the user actually filled one in.
        if (ep.host || ep.user) {
          body.endpoints = [
            { label: ep.label || 'primary', user: ep.user, host: ep.host, port: ep.port, identity: ep.identity },
          ];
        }
      } else {
        body.host = draft.host;
        body.labels = String(draft.labelsText ?? '');
      }
      const d = await post('/api/routing/runners', body);
      setRunners(d.runners ?? []);
      setShowNew(false);
      setDraft({ kind: 'remote', label: '', labelsText: 'self-hosted, anyrealm-vm', workDir: '/mnt/anyrealm', endpoint: { ...EMPTY_ENDPOINT } });
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [draft, load]);

  const addEndpoint = useCallback(async (runnerId: string) => {
    setBusy(`ep:${runnerId}`);
    setError(null);
    try {
      const d = await post(`/api/routing/runners/${runnerId}/endpoints`, endpointDraft);
      setRunners(d.runners ?? []);
      setShowEndpointFor(null);
      setEndpointDraft({ ...EMPTY_ENDPOINT });
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [endpointDraft, load]);

  const activateEndpoint = useCallback(async (runnerId: string, endpointId: string) => {
    setBusy(`act:${runnerId}`);
    setError(null);
    try {
      const d = await post(`/api/routing/runners/${runnerId}/endpoints/activate`, { endpointId });
      setRunners(d.runners ?? []);
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const removeEndpoint = useCallback(async (runnerId: string, endpointId: string) => {
    setBusy(`delEp:${runnerId}`);
    setError(null);
    try {
      await api(`/api/routing/runners/${runnerId}/endpoints/${endpointId}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const setTemporaryRoute = useCallback(
    async (target: string, runnerId: string, minutes: number, note: string) => {
      setBusy('temporary');
      setError(null);
      try {
        const d = await post('/api/routing/temporary', { target, runnerId, minutes, note });
        setTemporary(d.temporary ?? null);
        setEffective(d.effective ?? effective);
        setWarnings(d.warnings ?? []);
        await load();
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setBusy(null);
      }
    },
    [effective, load],
  );

  const clearTemporary = useCallback(async () => {
    setBusy('clearTemporary');
    setError(null);
    try {
      const d = await api('/api/routing/temporary', { method: 'DELETE' });
      setTemporary(null);
      setEffective(d.effective ?? { ...route, temporary: false });
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [load, route]);

  const promoteTemporary = useCallback(async () => {
    setBusy('promote');
    setError(null);
    try {
      const d = await post('/api/routing/temporary/promote', {});
      setTemporary(null);
      setRoute(d.route);
      setEffective(d.effective ?? { ...d.route, temporary: false });
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const removeRunner = useCallback(async (id: string) => {
    setBusy(`del:${id}`);
    try {
      await api(`/api/routing/runners/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const usable = useMemo(() => runners.filter((r) => r.kind === route.target), [runners, route.target]);
  const assigned = route.runnerId ? runners.find((r) => r.id === route.runnerId) : null;

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-10 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading compile routing…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">✕</button>
        </div>
      )}

      {/* current route */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              {TARGET_ICON[route.target]} Compile route
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {route.target === 'local'
                ? 'Building on this machine.'
                : assigned
                ? `Building on ${assigned.label} via ${assigned.address || '(no address)'}.`
                : 'No runner assigned — the build has nowhere to go.'}
            </p>
            {route.reason && <p className="text-[10px] text-slate-500 italic mt-0.5">why: {route.reason}</p>}
          </div>
          <button
            onClick={() => probe('local')}
            disabled={busy !== null}
            className="flex items-center gap-1.5 border border-[#1e293b] text-slate-300 hover:text-white text-[11px] px-2.5 py-1.5 rounded"
          >
            {busy === 'probe:local' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Probe everything
          </button>
        </div>

        {warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="text-[10px] text-amber-300 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* target picker */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {targets.map((t) => {
          const active = route.target === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                const first = runners.find((r) => r.kind === t.id);
                chooseTarget(t.id, t.id === 'local' ? null : first?.id ?? null);
              }}
              className={`text-left border rounded-xl p-3 transition-colors ${
                active ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-[#1e293b] bg-[#0b1220] hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                  {TARGET_ICON[t.id]} {t.label}
                </span>
                {active && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">{t.summary}</div>
              <div className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">{t.detail}</div>
              <div className="mt-1.5 text-[10px] text-emerald-300/80">best for: {t.bestFor}</div>
              <ul className="mt-1 space-y-0.5">
                {t.risks.map((r, i) => (
                  <li key={i} className="text-[10px] text-rose-300/70 flex items-start gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" /> {r}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </section>

      {/* runners for the active target */}
      {route.target !== 'local' && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
          <h3 className="text-xs font-bold text-white mb-2">
            {route.target === 'actions' ? 'Actions' : 'Remote'} runners
            <span className="text-slate-500 font-normal"> ({usable.length})</span>
          </h3>

          {usable.length === 0 ? (
            <p className="text-[11px] text-amber-300">
              No {route.target} runner yet. Create one below — the route stays unassigned until then.
            </p>
          ) : (
            <div className="space-y-2">
              {usable.map((r) => {
                const isAssigned = route.runnerId === r.id;
                const specific = showEndpointFor === r.id;
                return (
                  <div
                    key={r.id}
                    className={`border rounded-lg p-2.5 ${
                      isAssigned ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[#1e293b] bg-[#0b1220]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold text-white">{r.label}</span>
                          <span className="text-[9px] font-mono px-1 rounded border border-slate-700 text-slate-400">
                            {r.kind}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {r.kind === 'remote' ? r.address || '(no address)' : r.host} → {r.workDir}
                        </div>
                        {r.labels?.length ? (
                          <div className="text-[10px] text-slate-500">
                            labels: <span className="font-mono text-slate-400">{r.labels.join(', ')}</span>
                          </div>
                        ) : null}
                        {r.notes && <div className="text-[10px] text-slate-500 italic">{r.notes}</div>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => chooseTarget(route.target, r.id)}
                          disabled={isAssigned || busy !== null}
                          className={`text-[10px] px-2 py-0.5 rounded border ${
                            isAssigned
                              ? 'border-emerald-500/40 text-emerald-300'
                              : 'border-[#1e293b] text-slate-400 hover:text-white'
                          }`}
                        >
                          {isAssigned ? 'assigned' : 'assign'}
                        </button>
                        <button
                          onClick={() => probe(r.id)}
                          disabled={busy !== null}
                          className="text-[10px] px-2 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-white"
                        >
                          {busy === `probe:${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'probe'}
                        </button>
                        <button
                          onClick={() => removeRunner(r.id)}
                          disabled={busy !== null}
                          className="text-slate-500 hover:text-rose-400 px-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* ---------------- remote tabs ---------------- */}
                    {r.kind === 'remote' && (
                      <div className="mt-2 border-t border-[#1e293b] pt-2">
                        <div className="flex items-center gap-1 mb-2">
                          {(
                            [
                              ['addresses', `Addresses (${(r.endpoints ?? []).length})`, <Network className="w-3 h-3" />],
                              ['temporary', 'Temporary route', <Clock className="w-3 h-3" />],
                            ] as Array<['addresses' | 'temporary', string, React.ReactNode]>
                          ).map(([id, label, icon]) => {
                            const on = (runnerTab[r.id] ?? 'addresses') === id;
                            return (
                              <button
                                key={id}
                                onClick={() => setRunnerTab((prev) => ({ ...prev, [r.id]: id }))}
                                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${
                                  on
                                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                                    : 'border-[#1e293b] text-slate-400 hover:text-white'
                                }`}
                              >
                                {icon} {label}
                              </button>
                            );
                          })}
                        </div>

                        {(runnerTab[r.id] ?? 'addresses') === 'addresses' && (
                        <>
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Network className="w-3 h-3 text-cyan-400" /> build-through address
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => probe(r.id)}
                              disabled={busy !== null}
                              className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded border border-[#1e293b]"
                            >
                              probe all
                            </button>
                            <button
                              onClick={() => {
                                setShowEndpointFor(specific ? null : r.id);
                                setEndpointDraft({ ...EMPTY_ENDPOINT });
                              }}
                              className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded border border-[#1e293b] flex items-center gap-1"
                            >
                              <Plus className="w-2.5 h-2.5" /> address
                            </button>
                          </div>
                        </div>

                        {(r.endpoints ?? []).length === 0 && (
                          <div className="text-[10px] text-rose-300 mt-1">
                            no address yet — this remote cannot be probed or built through
                          </div>
                        )}

                        <div className="mt-1.5 space-y-1">
                          {(r.endpoints ?? []).map((ep) => {
                            const p = probes[probeKey(r.id, ep.id)];
                            const active = r.endpointId === ep.id;
                            return (
                              <div
                                key={ep.id}
                                className={`flex items-center justify-between gap-2 rounded px-2 py-1 border ${
                                  active ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-[#1e293b]/60'
                                }`}
                              >
                                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-mono px-1 rounded border border-slate-700 text-slate-400">
                                    {ep.label}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-300 truncate">
                                    {ep.user}@{ep.host}:{ep.port}
                                  </span>
                                  {active && <span className="text-[9px] text-cyan-300">active</span>}
                                  {p &&
                                    (p.reachable ? (
                                      <span className="text-[9px] text-emerald-300 flex items-center gap-0.5">
                                        <CheckCircle2 className="w-2.5 h-2.5" /> ok
                                        {p.latencyMs ? ` ${p.latencyMs}ms` : ''}
                                      </span>
                                    ) : (
                                      <span className="text-[9px] text-rose-300 flex items-center gap-0.5" title={p.error}>
                                        <XCircle className="w-2.5 h-2.5" /> unreachable
                                      </span>
                                    ))}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  {!active && (
                                    <button
                                      onClick={() => activateEndpoint(r.id, ep.id)}
                                      disabled={busy !== null}
                                      title="build through this address"
                                      className="text-[9px] px-1.5 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-cyan-300 flex items-center gap-0.5"
                                    >
                                      <ArrowRightLeft className="w-2.5 h-2.5" /> use
                                    </button>
                                  )}
                                  <button
                                    onClick={() => probe(r.id, ep.id)}
                                    disabled={busy !== null}
                                    className="text-[9px] px-1.5 py-0.5 rounded border border-[#1e293b] text-slate-400 hover:text-white"
                                  >
                                    {busy === `probe:${r.id}:${ep.id}` ? '…' : 'probe'}
                                  </button>
                                  <button
                                    onClick={() => removeEndpoint(r.id, ep.id)}
                                    disabled={busy !== null}
                                    className="text-slate-600 hover:text-rose-400 px-0.5"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {specific && (
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-1.5 bg-[#0b1220] border border-[#1e293b] rounded p-2">
                            {(
                              [
                                ['label', 'lan / public / tunnel'],
                                ['user', 'user'],
                                ['host', 'ip or dns name'],
                                ['port', '22'],
                                ['identity', 'key path (optional)'],
                              ] as Array<[string, string]>
                            ).map(([key, ph]) => (
                              <input
                                key={key}
                                value={String(endpointDraft[key] ?? '')}
                                onChange={(e) =>
                                  setEndpointDraft({
                                    ...endpointDraft,
                                    [key]: key === 'port' ? Number(e.target.value) : e.target.value,
                                  })
                                }
                                placeholder={ph}
                                className="bg-[#0f172a] border border-[#1e293b] rounded px-2 py-1 text-[10px] font-mono text-slate-200 placeholder:text-slate-600"
                              />
                            ))}
                            <button
                              onClick={() => addEndpoint(r.id)}
                              disabled={busy !== null}
                              className="md:col-span-3 flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[10px] font-bold px-3 py-1.5 rounded"
                            >
                              {busy === `ep:${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Add address to {r.label}
                            </button>
                          </div>
                        )}

                        </>
                        )}

                        {(runnerTab[r.id] ?? 'addresses') === 'temporary' && (
                          <TemporaryPanel
                            runner={r}
                            temporary={temporary}
                            effective={effective}
                            nowMs={nowMs}
                            busy={busy}
                            onSet={setTemporaryRoute}
                            onClear={clearTemporary}
                            onPromote={promoteTemporary}
                          />
                        )}

                        {/* per-endpoint probe details */}
                        {(runnerTab[r.id] ?? 'addresses') === 'addresses' && (r.endpoints ?? []).map((ep) => {
                          const p = probes[probeKey(r.id, ep.id)];
                          if (!p || (!p.error && p.facts.length === 0)) return null;
                          return (
                            <div key={`d-${ep.id}`} className="mt-1 pl-2 border-l border-[#1e293b]">
                              <div className="text-[9px] text-slate-500 font-mono">{ep.label}</div>
                              {p.error && <div className="text-[10px] text-rose-300 font-mono break-all">{p.error}</div>}
                              {p.facts.map((f, i) => (
                                <div key={i} className="text-[10px] text-slate-400 font-mono">{f}</div>
                              ))}
                              {p.latencyMs !== null && p.latencyMs > 3000 && (
                                <div className="text-[10px] text-amber-300 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" /> {p.latencyMs}ms — every poll will feel slow
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* create runner */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <Plus className="w-3.5 h-3.5 text-cyan-400" /> New runner
          </h3>
          <button
            onClick={() => setShowNew((v) => !v)}
            className={BTN}
          >
            {showNew ? 'cancel' : 'add runner'}
          </button>
        </div>

        {showNew && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className={LABEL}>
              kind
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                className={FIELD + ' mt-0.5 w-full'}
              >
                <option value="remote">remote (SSH)</option>
                <option value="actions">actions (self-hosted)</option>
              </select>
            </label>
            <label className={LABEL}>
              label
              <input
                value={draft.label ?? ''}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="Azure build VM"
                className={FIELD + ' mt-0.5 w-full'}
              />
            </label>
            <label className={LABEL}>
              work dir
              <input
                value={draft.workDir ?? ''}
                onChange={(e) => setDraft({ ...draft, workDir: e.target.value })}
                placeholder="/mnt/anyrealm"
                className={FIELD_MONO + ' mt-0.5 w-full'}
              />
            </label>

            {draft.kind === 'remote' ? (
              <>
                <div className="md:col-span-3 text-[10px] text-slate-500 mt-1">
                  First address. You can add more (LAN, public, tunnel) after it exists and swap between them.
                </div>
                {(
                  [
                    ['label', 'lan / public / tunnel'],
                    ['user', 'user'],
                    ['host', 'ip or dns name'],
                    ['port', '22'],
                    ['identity', 'key path (optional)'],
                  ] as Array<[string, string]>
                ).map(([key, ph]) => (
                  <input
                    key={key}
                    value={String(draft.endpoint?.[key] ?? '')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        endpoint: {
                          ...(draft.endpoint ?? {}),
                          [key]: key === 'port' ? Number(e.target.value) : e.target.value,
                        },
                      })
                    }
                    placeholder={ph}
                    className={FIELD_MONO}
                  />
                ))}
                {(
                  [
                    ['cores', 'cores (fit check)'],
                    ['ramGb', 'RAM GiB'],
                  ] as Array<[string, string]>
                ).map(([key, ph]) => (
                  <input
                    key={key}
                    type="number"
                    value={draft[key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                    placeholder={ph}
                    className={FIELD}
                  />
                ))}
              </>
            ) : (
              <>
                <label className={LABEL + ' md:col-span-2'}>
                  repository (owner/repo)
                  <input
                    value={draft.host ?? ''}
                    onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                    placeholder="owner/repo"
                    className={FIELD_MONO + ' mt-0.5 w-full'}
                  />
                </label>
                <label className={LABEL}>
                  runner labels
                  <input
                    value={draft.labelsText ?? ''}
                    onChange={(e) => setDraft({ ...draft, labelsText: e.target.value })}
                    placeholder="self-hosted, anyrealm-vm"
                    className={FIELD_MONO + ' mt-0.5 w-full'}
                  />
                </label>
              </>
            )}

            <label className={LABEL + ' md:col-span-3'}>
              notes
              <input
                value={draft.notes ?? ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Standard_E4ds_v4, /mnt is 147 GB"
                className={FIELD + ' mt-0.5 w-full'}
              />
            </label>

            <button
              onClick={saveRunner}
              disabled={busy !== null}
              className="md:col-span-3 flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded"
            >
              {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save runner
            </button>
          </div>
        )}

        {runners.length > 0 && !showNew && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {runners.map((r) => (
              <span
                key={r.id}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#1e293b] text-slate-400"
              >
                {r.kind}:{r.label}
                {r.kind === 'remote' ? ` (${(r.endpoints ?? []).length} addr)` : ''}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="text-[10px] text-slate-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        Nothing here starts a build. It records where a dispatch would go and probes the addresses so an unreachable
        host fails here, not an hour into a compile.
      </div>
    </div>
  );
}
