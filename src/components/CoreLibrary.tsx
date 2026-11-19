/**
 * Core Library + Format Registry.
 *
 * One tab, because they answer the same question from two ends. The library
 * holds the directories you have already vouched for; the registry holds the
 * formats those directories are made of, and says which of them this machine can
 * actually open.
 *
 * Both are rendered from the server's own lists, so adding a format or a slot is
 * a backend change only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FolderOpen,
  Plus,
  Trash2,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Package,
  FileArchive,
  HardDrive,
  Cpu,
  Wrench,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface LibraryEntry {
  id: string;
  path: string;
  label: string;
  slots: string[];
  kind: string;
  evidence: string[];
  stats: { files: number; bytes: number; truncated: boolean; scannedAt: string };
  notes: string[];
  warnings: string[];
}

interface SlotDef {
  id: string;
  label: string;
  hint: string;
}

interface Assignment {
  id: string;
  label: string;
  hint: string;
  entries: Array<{ id: string; label: string; path: string; kind: string }>;
  resolved: string | null;
}

interface FormatRow {
  id: string;
  family: string;
  label: string;
  extensions: string[];
  magic: string[];
  tools: string[];
  canInspect: boolean;
  canUnpack: boolean;
  canRepack: boolean;
  repackNote: string | null;
  note: string | null;
}

interface ToolRow {
  tool: string;
  path: string | null;
  blocks: string[];
}

function humanBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const FAMILY_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  archive: { label: 'Archives', color: 'text-amber-300 border-amber-500/30 bg-amber-500/10', icon: <FileArchive className="w-3.5 h-3.5" /> },
  compressed: { label: 'Compression', color: 'text-sky-300 border-sky-500/30 bg-sky-500/10', icon: <Package className="w-3.5 h-3.5" /> },
  filesystem: { label: 'Filesystems', color: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', icon: <HardDrive className="w-3.5 h-3.5" /> },
  android: { label: 'Android payloads', color: 'text-violet-300 border-violet-500/30 bg-violet-500/10', icon: <Cpu className="w-3.5 h-3.5" /> },
  kernel: { label: 'Kernel images', color: 'text-rose-300 border-rose-500/30 bg-rose-500/10', icon: <Cpu className="w-3.5 h-3.5" /> },
};

export default function CoreLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [slots, setSlots] = useState<SlotDef[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newDir, setNewDir] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newSlots, setNewSlots] = useState<string[]>([]);

  const [openFamily, setOpenFamily] = useState<Record<string, boolean>>({ archive: true });
  const [showTools, setShowTools] = useState(false);

  const loadLibrary = useCallback(async () => {
    const r = await fetch('/api/library');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    setEntries(d.entries ?? []);
    setSlots(d.slots ?? []);
    setAssignments(d.assignments ?? []);
  }, []);

  const loadFormats = useCallback(async () => {
    const [f, t] = await Promise.all([fetch('/api/formats'), fetch('/api/formats/tools')]);
    const fd = await f.json();
    const td = await t.json();
    setFormats(fd.formats ?? []);
    setTools(td.tools ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadLibrary(), loadFormats()]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadLibrary, loadFormats]);

  const indexDir = useCallback(async () => {
    if (!newDir.trim()) return;
    setBusy('index');
    setError(null);
    try {
      const r = await fetch('/api/library/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: newDir.trim(), label: newLabel.trim() || undefined, slots: newSlots }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'index failed');
      setNewDir('');
      setNewLabel('');
      setNewSlots([]);
      await loadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [newDir, newLabel, newSlots, loadLibrary]);

  const toggleSlot = useCallback(
    async (entry: LibraryEntry, slot: string) => {
      const next = entry.slots.includes(slot) ? entry.slots.filter((s) => s !== slot) : [...entry.slots, slot];
      setBusy(entry.id);
      try {
        const r = await fetch('/api/library/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId: entry.id, slots: next }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'assign failed');
        setAssignments(d.assignments ?? []);
        await loadLibrary();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [loadLibrary],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const r = await fetch(`/api/library/${id}`, { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'remove failed');
        setAssignments(d.assignments ?? []);
        await loadLibrary();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [loadLibrary],
  );

  const missingTools = useMemo(() => tools.filter((t) => !t.path), [tools]);
  const grouped = useMemo(() => {
    const m = new Map<string, FormatRow[]>();
    for (const f of formats) {
      if (!m.has(f.family)) m.set(f.family, []);
      m.get(f.family)!.push(f);
    }
    return [...m.entries()];
  }, [formats]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-10 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading the library and the format registry…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 border border-rose-500/30 bg-rose-500/10 text-rose-200 rounded-lg p-3 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">✕</button>
        </div>
      )}

      {/* ---------- slot assignment ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" /> Build slots
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              What each slot currently resolves to. Panels prefill from here instead of asking again.
            </p>
          </div>
          <button
            onClick={() => Promise.all([loadLibrary(), loadFormats()]).catch((e) => setError(String(e)))}
            className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white border border-[#1e293b] rounded px-2 py-1"
          >
            <RefreshCw className="w-3 h-3" /> Rescan
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          {assignments.map((a) => {
            const resolved = a.entries.find((e) => e.id === a.resolved);
            return (
              <div
                key={a.id}
                className={`rounded-lg border p-2.5 ${
                  resolved ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[#1e293b] bg-[#0b1220]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white">{a.label}</span>
                  {resolved ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <span className="text-[9px] text-slate-500 border border-slate-700 rounded px-1">empty</span>
                  )}
                </div>
                <div className="mt-1 text-[10px] font-mono break-all leading-snug">
                  {resolved ? (
                    <span className="text-emerald-300">{resolved.path}</span>
                  ) : (
                    <span className="text-slate-500">{a.hint}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- index a directory ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <FolderOpen className="w-4 h-4 text-cyan-400" /> Index a local directory
        </h2>
        <p className="text-[11px] text-slate-400 mb-3">
          Point at an absolute path. The scan is structural — a folder named "kernel" that has no kernel
          Makefile is not reported as a kernel tree.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px_auto] gap-2">
          <input
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="/home/you/src/kernel-zenith"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (optional)"
            className="bg-[#0b1220] border border-[#1e293b] rounded px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
          <button
            onClick={indexDir}
            disabled={busy === 'index' || !newDir.trim()}
            className="flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded"
          >
            {busy === 'index' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Index
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-[10px] text-slate-500 self-center">assign on index:</span>
          {slots.map((s) => {
            const on = newSlots.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => setNewSlots((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                title={s.hint}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  on
                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                    : 'border-[#1e293b] text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------- indexed entries ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Save className="w-4 h-4 text-indigo-400" /> Library
            <span className="text-[10px] font-normal text-slate-500">({entries.length} director{entries.length === 1 ? 'y' : 'ies'})</span>
          </h2>
        </div>

        {entries.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            Nothing indexed yet. Indexing a directory here makes its path available to every panel.
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="border border-[#1e293b] rounded-lg p-3 bg-[#0b1220]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white">{e.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
                        {e.kind}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {e.stats.files.toLocaleString()}
                        {e.stats.truncated ? '+' : ''} files
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{humanBytes(e.stats.bytes)}</span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-1 break-all">{e.path}</div>
                    {e.evidence.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.evidence.map((ev, i) => (
                          <span key={i} className="text-[9px] text-slate-400 bg-slate-800/60 rounded px-1.5 py-0.5">
                            {ev}
                          </span>
                        ))}
                      </div>
                    )}
                    {e.warnings.map((w, i) => (
                      <div key={i} className="mt-1 text-[10px] text-amber-300 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => removeEntry(e.id)}
                    disabled={busy === e.id}
                    className="text-slate-500 hover:text-rose-400 shrink-0"
                    title="Remove from library (does not touch the directory)"
                  >
                    {busy === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {slots.map((s) => {
                    const on = e.slots.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSlot(e, s.id)}
                        title={s.hint}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                          on
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                            : 'border-[#1e293b] text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- format registry ---------- */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <FileArchive className="w-4 h-4 text-amber-400" /> Format registry
            <span className="text-[10px] font-normal text-slate-500">({formats.length} formats)</span>
          </h2>
          <button
            onClick={() => setShowTools((v) => !v)}
            className={`flex items-center gap-1.5 text-[11px] border rounded px-2 py-1 ${
              missingTools.length
                ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                : 'border-[#1e293b] text-slate-400 hover:text-white'
            }`}
          >
            <Wrench className="w-3 h-3" />
            {missingTools.length ? `${missingTools.length} tool(s) missing` : 'all tools present'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mb-3">
          Every format the builder knows, with the tool that inspects, unpacks and repacks it. A format is only
          usable when its tools are installed.
        </p>

        {showTools && (
          <div className="mb-3 border border-[#1e293b] rounded-lg overflow-hidden">
            <table className="w-full text-[10px]">
              <thead className="bg-[#0b1220] text-slate-400">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">Tool</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Status</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Formats it unlocks</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.tool} className="border-t border-[#1e293b]/60">
                    <td className="px-2 py-1 font-mono text-slate-200">{t.tool}</td>
                    <td className="px-2 py-1">
                      {t.path ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> {t.path}
                        </span>
                      ) : (
                        <span className="text-rose-400 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> missing
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-slate-400">{t.path ? '—' : t.blocks.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-2">
          {grouped.map(([family, rows]) => {
            const meta = FAMILY_META[family] ?? {
              label: family,
              color: 'text-slate-300 border-slate-500/30 bg-slate-500/10',
              icon: <FileArchive className="w-3.5 h-3.5" />,
            };
            const open = openFamily[family] ?? false;
            return (
              <div key={family} className="border border-[#1e293b] rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenFamily((p) => ({ ...p, [family]: !open }))}
                  className="w-full flex items-center justify-between px-3 py-2 bg-[#0b1220] hover:bg-[#111a2e]"
                >
                  <span className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span className={`px-1.5 py-0.5 rounded border ${meta.color} flex items-center gap-1`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="text-[10px] font-normal text-slate-500">{rows.length}</span>
                  </span>
                </button>

                {open && (
                  <div className="divide-y divide-[#1e293b]/60">
                    {rows.map((f) => {
                      const missing = f.tools.filter((t) => !tools.find((x) => x.tool === t)?.path);
                      return (
                        <div key={f.id} className="px-3 py-2 text-[11px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-slate-200 font-semibold">{f.label}</span>
                            {f.extensions.filter(Boolean).map((x) => (
                              <span key={x} className="text-[9px] font-mono text-slate-500 bg-slate-800/60 rounded px-1">
                                {x}
                              </span>
                            ))}
                            <span className="ml-auto flex items-center gap-1.5">
                              {[
                                ['inspect', f.canInspect],
                                ['unpack', f.canUnpack],
                                ['repack', f.canRepack],
                              ].map(([k, v]) => (
                                <span
                                  key={String(k)}
                                  className={`text-[9px] px-1 rounded border ${
                                    v
                                      ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                                      : 'border-slate-700 text-slate-500'
                                  }`}
                                >
                                  {String(k)}
                                </span>
                              ))}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] text-slate-500">tools:</span>
                            {f.tools.map((t) => {
                              const ok = !!tools.find((x) => x.tool === t)?.path;
                              return (
                                <span
                                  key={t}
                                  className={`text-[9px] font-mono px-1 rounded ${
                                    ok ? 'text-emerald-300 bg-emerald-500/10' : 'text-rose-300 bg-rose-500/10'
                                  }`}
                                >
                                  {t}
                                  {ok ? '' : ' ✗'}
                                </span>
                              );
                            })}
                          </div>

                          {f.note && (
                            <div className="mt-1 text-[10px] text-slate-400 flex items-start gap-1">
                              <Info className="w-3 h-3 shrink-0 mt-0.5 text-slate-500" /> {f.note}
                            </div>
                          )}
                          {!f.canRepack && f.repackNote && (
                            <div className="mt-1 text-[10px] text-amber-300/90 flex items-start gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {f.repackNote}
                            </div>
                          )}
                          {missing.length > 0 && (
                            <div className="mt-1 text-[10px] text-rose-300/90">
                              cannot be opened here: {missing.join(', ')} not installed
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
      </section>
    </div>
  );
}
