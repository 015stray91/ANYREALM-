import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  GitBranch,
  HardDrive,
  Radio,
  Loader2,
} from 'lucide-react';

type Kind = 'rom' | 'rom_x86' | 'mobile_linux' | 'desktop_linux' | 'kernel' | 'desktop_env';

interface Freshness {
  status: 'not-mirrored' | 'current' | 'behind' | 'unreachable';
  detail: string;
}

interface SourceRow {
  id: string;
  name: string;
  url: string;
  kind: Kind;
  reachable: boolean;
  defaultBranch?: string;
  headSha?: string;
  branches?: number;
  tags?: number;
  latencyMs: number;
  error?: string;
  freshness: Freshness;
  mirror: {
    mirrorPath: string;
    headSha?: string;
    defaultBranch?: string;
    bytes?: number;
    fetchedAt?: string;
  };
}

interface ProbeResponse {
  checkedAt: string;
  mirrorRoot: string;
  cached: boolean;
  sources: SourceRow[];
  error?: string;
}

const KIND_LABEL: Record<Kind, string> = {
  rom: 'Custom ROM',
  rom_x86: 'Android x86_64',
  mobile_linux: 'Mobile Linux',
  desktop_linux: 'Desktop Linux',
  kernel: 'Kernel',
  desktop_env: 'Desktop env',
};

const KIND_STYLE: Record<Kind, string> = {
  rom: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rom_x86: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  mobile_linux: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  desktop_linux: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  kernel: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  desktop_env: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

function humanBytes(n?: number): string {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function FreshnessBadge({ f }: { f: Freshness }) {
  const map = {
    current: { icon: CheckCircle2, cls: 'text-emerald-400', label: 'up to date' },
    behind: { icon: AlertTriangle, cls: 'text-amber-400', label: 'update available' },
    'not-mirrored': { icon: HardDrive, cls: 'text-slate-500', label: 'not pulled yet' },
    unreachable: { icon: XCircle, cls: 'text-rose-400', label: 'unreachable' },
  } as const;
  const { icon: Icon, cls, label } = map[f.status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

export default function SourceSync() {
  const [data, setData] = useState<ProbeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pushLog = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 200));

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/sources/probe${force ? '?force=1' : ''}`);
        const json = (await res.json()) as ProbeResponse;
        if (json.error) throw new Error(json.error);
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const pull = async (row: SourceRow) => {
    setBusy((b) => ({ ...b, [row.id]: 'starting' }));
    pushLog(`pull ${row.id} from ${row.url}`);
    try {
      setBusy((b) => ({ ...b, [row.id]: 'fetching' }));
      const res = await fetch('/api/sources/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const out = await res.json();
      if (out.error) {
        pushLog(`  FAILED ${row.id}: ${out.error}`);
        setBusy((b) => ({ ...b, [row.id]: 'error' }));
      } else {
        pushLog(
          `  ${out.action} ${row.id} @ ${String(out.headSha ?? '').slice(0, 10)} ` +
            `(${humanBytes(out.bytes)}, ${Math.round((out.durationMs ?? 0) / 1000)}s)`,
        );
        setBusy((b) => ({ ...b, [row.id]: 'done' }));
        // A finished pull changes freshness for that row; refresh quietly.
        load(true);
      }
    } catch (err) {
      pushLog(`  FAILED ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      setBusy((b) => ({ ...b, [row.id]: 'error' }));
    }
  };

  const rows = useMemo(
    () => (data?.sources ?? []).filter((s) => filter === 'all' || s.kind === filter),
    [data, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.sources.length ?? 0 };
    for (const s of data?.sources ?? []) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [data]);

  const stale = (data?.sources ?? []).filter((s) => s.freshness.status === 'behind').length;
  const down = (data?.sources ?? []).filter((s) => s.freshness.status === 'unreachable').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            Upstream Sources
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            The custom ROM, mobile Linux, desktop Linux and kernel trees this builder
            compiles from. Every remote is queried live, so what you see is what upstream
            has right now — not a version baked into an old ISO.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Re-check upstream
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'sources', value: data?.sources.length ?? 0, cls: 'text-slate-100' },
          { label: 'up to date', value: (data?.sources ?? []).filter((s) => s.freshness.status === 'current').length, cls: 'text-emerald-400' },
          { label: 'behind', value: stale, cls: 'text-amber-400' },
          { label: 'unreachable', value: down, cls: 'text-rose-400' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div className={`text-xl font-semibold ${s.cls}`}>{s.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'rom', 'rom_x86', 'mobile_linux', 'desktop_linux', 'kernel', 'desktop_env'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
              filter === k
                ? 'bg-slate-700 border-slate-600 text-slate-100'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {k === 'all' ? 'All' : KIND_LABEL[k]}
            <span className="ml-1.5 text-slate-500">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-900/80 text-slate-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">Source</th>
              <th className="text-left font-medium px-3 py-2">Kind</th>
              <th className="text-left font-medium px-3 py-2">Branch / HEAD</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-left font-medium px-3 py-2">Local mirror</th>
              <th className="text-right font-medium px-3 py-2">Pull</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  querying upstream remotes…
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const b = busy[s.id];
              return (
                <tr key={s.id} className="hover:bg-slate-900/40">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-200">{s.name}</div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-slate-500 hover:text-sky-400 break-all"
                    >
                      {s.url}
                    </a>
                    {s.error && (
                      <div className="text-[11px] text-rose-400 mt-1 line-clamp-2">{s.error}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${KIND_STYLE[s.kind]}`}>
                      {KIND_LABEL[s.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <GitBranch className="w-3 h-3 text-slate-500" />
                      {s.defaultBranch ?? '—'}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                      {s.headSha?.slice(0, 10) ?? '—'}
                      {typeof s.branches === 'number' && (
                        <span className="ml-2 text-slate-600">
                          {s.branches} br · {s.tags ?? 0} tag
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <FreshnessBadge f={s.freshness} />
                    <div className="text-[11px] text-slate-500 mt-0.5">{s.freshness.detail}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">
                    {s.mirror.headSha ? (
                      <>
                        <div className="font-mono text-[11px]">{s.mirror.headSha.slice(0, 10)}</div>
                        <div className="text-[11px] text-slate-500">{humanBytes(s.mirror.bytes)}</div>
                      </>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => pull(s)}
                      disabled={!!b && b !== 'done' && b !== 'error'}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-50 cursor-pointer"
                    >
                      {b === 'fetching' || b === 'starting' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : b === 'done' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : b === 'error' ? (
                        <AlertTriangle className="w-3 h-3 text-rose-400" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      {s.mirror.headSha ? 'Update' : 'Pull'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="text-[11px] text-slate-500">
          checked {new Date(data.checkedAt).toLocaleString()}
          {data.cached ? ' (cached)' : ''} · mirrors in{' '}
          <code className="text-slate-400">{data.mirrorRoot}</code> · pulls are
          blob-filtered, so a full ROM tree does not download every historical object
        </div>
      )}

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          Sync log
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/70 h-40 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
          {log.length === 0 ? (
            <span className="text-slate-600">no pulls yet</span>
          ) : (
            log.map((line, i) => (
              <div key={i} className={line.includes('FAILED') ? 'text-rose-400' : 'text-slate-400'}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
