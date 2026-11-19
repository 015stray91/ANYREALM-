/**
 * Partition dump inspector.
 *
 * The input is the raw output of `ls` in a device-dump folder — the real thing,
 * with names like `xbl_b_backup_2026-03-27_06-39-12.tar`. Splitting that into
 * snapshots and classifying each file is the whole job; the interesting output is
 * not "recognised 214 files" but "these 57 are signed blobs you must not
 * repack, and these 3 snapshots cannot be mixed".
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Layers,
  FileArchive,
  HardDrive,
  Lock,
  Info,
  Copy,
  Wrench,
} from 'lucide-react';

interface ParsedName {
  fileName: string;
  partition: string | null;
  slot: 'a' | 'b' | 'ab' | 'none';
  timestamp: string | null;
  container: string;
  spec: {
    name: string;
    cls: string;
    what: string;
    inspect: string[];
    unpack: string[];
    repack: string[] | 'keep-original' | null;
    repackNote?: string;
    critical: boolean;
    slot: string;
  } | null;
  notes: string[];
  warnings: string[];
}

interface Snapshot {
  timestamp: string;
  files: number;
  partitions: number;
  duplicates: Array<{ partition: string; files: string[] }>;
  criticalCount: number;
  opaqueCount: number;
  unsupported: string[];
}

interface ClassifyResponse {
  files: number;
  recognised: number;
  unrecognised: string[];
  snapshots: Snapshot[];
  results: ParsedName[];
}

const CLASS_STYLE: Record<string, { label: string; color: string }> = {
  'android-image': { label: 'Android image', color: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  'dynamic-super': { label: 'Super', color: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
  filesystem: { label: 'Filesystem', color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  'firmware-blob': { label: 'Signed fw', color: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  'vendor-data': { label: 'Vendor data', color: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  'raw-region': { label: 'Raw region', color: 'border-slate-500/30 bg-slate-500/10 text-slate-300' },
  unknown: { label: 'Unknown', color: 'border-slate-600 text-slate-400' },
};

type Filter = 'all' | 'critical' | 'opaque' | 'actionable' | 'unrecognised';

export default function PartitionInspector() {
  const [listing, setListing] = useState('');
  const [data, setData] = useState<ClassifyResponse | null>(null);
  const [tools, setTools] = useState<Array<{ tool: string; path: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [snapshotFilter, setSnapshotFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/partitions/tools')
      .then((r) => r.json())
      .then((d) => setTools(d.tools ?? []))
      .catch(() => {});
  }, []);

  const classify = useCallback(async () => {
    if (!listing.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/partitions/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'classify failed');
      setData(d);
      setSnapshotFilter('all');
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [listing]);

  const presentTools = useMemo(() => new Set(tools.filter((t) => t.path).map((t) => t.tool)), [tools]);

  const missingNeeded = useMemo(() => {
    if (!data) return [];
    const need = new Set<string>();
    for (const r of data.results) {
      if (!r.spec) continue;
      for (const cmd of [...r.spec.inspect, ...r.spec.unpack]) {
        if (!cmd || cmd.startsWith('{') || cmd.startsWith('-')) continue;
        need.add(cmd);
      }
    }
    return [...need].filter((t) => !presentTools.has(t));
  }, [data, presentTools]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.results.filter((r) => {
      if (snapshotFilter !== 'all') {
        const ts = r.timestamp ?? '(no timestamp)';
        if (ts !== snapshotFilter) return false;
      }
      const cls = r.spec?.cls ?? 'unknown';
      switch (filter) {
        case 'critical':
          return !!r.spec?.critical;
        case 'opaque':
          return cls === 'firmware-blob' || cls === 'vendor-data' || cls === 'raw-region';
        case 'actionable':
          return !!r.spec && r.spec.unpack.length > 0;
        case 'unrecognised':
          return !r.partition;
        default:
          return true;
      }
    });
  }, [data, filter, snapshotFilter]);

  const counts = useMemo(() => {
    if (!data) return null;
    const byClass: Record<string, number> = {};
    for (const r of data.results) {
      const c = r.spec?.cls ?? 'unknown';
      byClass[c] = (byClass[c] ?? 0) + 1;
    }
    return {
      byClass,
      critical: data.results.filter((r) => r.spec?.critical).length,
      unpackable: data.results.filter((r) => (r.spec?.unpack.length ?? 0) > 0).length,
      keepOriginal: data.results.filter((r) => r.spec?.repack === 'keep-original').length,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <Layers className="w-4 h-4 text-amber-400" /> Partition dump inspector
        </h2>
        <p className="text-[11px] text-slate-400 mb-2">
          Paste the output of <span className="font-mono text-slate-300">ls</span> from your dump folder. Each file
          is matched to a known partition and the tool that handles it — including the ones where the right answer is
          "do not repack this".
        </p>

        <textarea
          value={listing}
          onChange={(e) => setListing(e.target.value)}
          placeholder={'abl_a_backup_2026-03-27_06-08-08.tar.gz\nboot.img\nvbmeta_b_backup_2026-03-27_06-39-12.img'}
          rows={8}
          className="w-full bg-[#0b1220] border border-[#1e293b] rounded px-2 py-1.5 text-[10px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={classify}
            disabled={busy || !listing.trim()}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 text-xs font-bold px-4 py-2 rounded"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileArchive className="w-3.5 h-3.5" />}
            Classify
          </button>
          {data && (
            <span className="text-[10px] text-slate-400">
              {data.recognised}/{data.files} recognised
            </span>
          )}
        </div>
      </section>

      {missingNeeded.length > 0 && (
        <div className="text-[11px] text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded p-2 flex items-start gap-2">
          <Wrench className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Not installed here: <span className="font-mono">{missingNeeded.join(', ')}</span>. Those partitions are
            still classified, but inspecting or unpacking them will fail until the tools are present.
          </span>
        </div>
      )}

      {data && counts && (
        <>
          {/* snapshots */}
          <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
            <h3 className="text-xs font-bold text-white mb-2">
              Snapshots <span className="text-slate-500 font-normal">({data.snapshots.length})</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {data.snapshots.map((s) => (
                <button
                  key={s.timestamp}
                  onClick={() => setSnapshotFilter(snapshotFilter === s.timestamp ? 'all' : s.timestamp)}
                  className={`text-left border rounded-lg p-2 transition-colors ${
                    snapshotFilter === s.timestamp
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-[#1e293b] bg-[#0b1220] hover:border-slate-600'
                  }`}
                >
                  <div className="text-[11px] font-mono text-slate-200">{s.timestamp}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                    <span>{s.partitions} partitions</span>
                    <span>{s.files} files</span>
                    <span className="text-rose-300">{s.criticalCount} critical</span>
                    <span className="text-amber-300">{s.opaqueCount} opaque</span>
                  </div>
                  {s.duplicates.length > 0 && (
                    <div className="mt-1 text-[9px] text-amber-300">
                      {s.duplicates.length} partition(s) appear twice — pick one
                    </div>
                  )}
                </button>
              ))}
            </div>
            {data.snapshots.length > 1 && (
              <div className="mt-2 text-[10px] text-amber-300 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                More than one snapshot: do not mix files across them. A modem from one and a bootloader from another
                is how verified boot fails.
              </div>
            )}
          </section>

          {/* summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(counts.byClass).map(([cls, n]) => {
              const st = CLASS_STYLE[cls] ?? CLASS_STYLE.unknown;
              return (
                <div key={cls} className={`border rounded-lg p-2 ${st.color}`}>
                  <div className="text-[10px] font-bold">{st.label}</div>
                  <div className="text-lg font-bold leading-none mt-0.5">{n}</div>
                </div>
              );
            })}
          </div>

          {counts.keepOriginal > 0 && (
            <div className="text-[11px] text-slate-300 bg-slate-800/40 border border-[#1e293b] rounded p-2 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>
                <span className="font-bold">{counts.keepOriginal}</span> partitions are signed or device-unique. The only
                correct "repack" is keeping the original bytes — the inspector does not offer to extract or rebuild
                them, because doing so bricks the device.
              </span>
            </div>
          )}

          {/* file list */}
          <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="text-xs font-bold text-white">
                Files <span className="text-slate-500 font-normal">({visible.length})</span>
              </h3>
              <div className="flex flex-wrap gap-1">
                {(['all', 'critical', 'opaque', 'actionable', 'unrecognised'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`text-[10px] px-2 py-0.5 rounded border ${
                      filter === f
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                        : 'border-[#1e293b] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1 max-h-[36rem] overflow-auto pr-1">
              {visible.map((r) => {
                const cls = r.spec?.cls ?? 'unknown';
                const st = CLASS_STYLE[cls] ?? CLASS_STYLE.unknown;
                return (
                  <div key={r.fileName} className="border border-[#1e293b] rounded bg-[#0b1220] p-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-slate-200 break-all">{r.fileName}</span>
                      {r.slot !== 'none' && (
                        <span className="text-[9px] px-1 rounded border border-slate-600 text-slate-400 font-mono">
                          slot {r.slot}
                        </span>
                      )}
                      <span className="text-[9px] px-1 rounded border border-slate-700 text-slate-400 font-mono">
                        {r.container}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${st.color}`}>{st.label}</span>
                      {r.spec?.critical && (
                        <span className="text-[9px] px-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> critical
                        </span>
                      )}
                    </div>

                    {r.spec && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                        <span className="text-slate-400">{r.spec.what}</span>
                        {r.spec.unpack.length > 0 ? (
                          <span className="text-emerald-300 font-mono flex items-center gap-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" /> {r.spec.unpack[0]}
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono flex items-center gap-0.5">
                            <XCircle className="w-2.5 h-2.5" /> no unpack
                          </span>
                        )}
                        <span
                          className={`font-mono ${
                            r.spec.repack === 'keep-original' ? 'text-rose-300' : 'text-slate-400'
                          }`}
                        >
                          repack: {r.spec.repack === 'keep-original' ? 'keep original' : Array.isArray(r.spec.repack) ? 'yes' : 'rebuild'}
                        </span>
                      </div>
                    )}

                    {r.spec?.repackNote && (
                      <div className="mt-0.5 text-[10px] text-amber-300/90 flex items-start gap-1">
                        <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" /> {r.spec.repackNote}
                      </div>
                    )}
                    {r.warnings.map((w, i) => (
                      <div key={i} className="mt-0.5 text-[10px] text-rose-300/90 flex items-start gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" /> {w}
                      </div>
                    ))}
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="text-[11px] text-slate-500 italic">Nothing matches this filter.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
