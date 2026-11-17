import React, { useCallback, useRef, useState } from 'react';
import {
  Upload,
  FileArchive,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Cpu,
  HardDrive,
  Layers,
  ArrowRight,
  Info,
} from 'lucide-react';

interface Layer {
  container: string;
  method: string;
  size: number;
}

interface BootInfo {
  kind: string;
  headerVersion: number;
  pageSize: number;
  kernel: { size: number; compression: string };
  ramdisk: { size: number; compression: string };
  osVersion?: { major: number; minor: number; patch: number; year: number; month: number };
  cmdline?: string;
  productName?: string;
  boardName?: string;
  fragments: Array<{ name: string; size: number; compression: string }>;
  twoStageRamdisk: boolean;
  warnings: string[];
  deviceHints: { summary: string[] };
}

interface ImageResult {
  name: string;
  ok: boolean;
  error?: string;
  bytes: number;
  kind?: string;
  container?: string;
  layers?: Layer[];
  unpackedBytes?: number;
  notes?: string[];
  looksLikeAndroidImage?: boolean;
  inner?: string;
  savedPath?: string;
  unpackedPath?: string;
  boot?: BootInfo;
}

interface DeviceShape {
  arch: string | null;
  headerVersion: number | null;
  gki: string;
  hasVendorBoot: boolean;
  hasInitBoot: boolean;
  twoStageRamdisk: boolean;
  sparseImages: number;
  facts: string[];
  warnings: string[];
  nextSteps: string[];
}

const COMPRESSION_BADGE: Record<string, string> = {
  none: 'bg-slate-700 text-slate-300',
  gzip: 'bg-emerald-500/20 text-emerald-300',
  xz: 'bg-sky-500/20 text-sky-300',
  lz4: 'bg-amber-500/20 text-amber-300',
  'lz4-legacy': 'bg-amber-500/20 text-amber-300',
  unknown: 'bg-slate-700 text-slate-400',
};

function humanBytes(n?: number): string {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** base64 encode a File without blowing the stack on large buffers. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const s = String(reader.result ?? '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.readAsDataURL(file);
  });
}

export default function FirmwareUploader() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [device, setDevice] = useState<DeviceShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setResults([]);
    setDevice(null);
    setProgress({ done: 0, total: files.length });

    try {
      const payload: Array<{ name: string; dataBase64: string }> = [];
      for (const [i, f] of files.entries()) {
        payload.push({ name: f.name, dataBase64: await toBase64(f) });
        setProgress({ done: i + 1, total: files.length });
      }
      const r = await fetch('/api/firmware/dissect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payload }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResults(d.results ?? []);
      setDevice(d.device ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Upload className="w-4 h-4 text-cyan-400" />
          Firmware Uploader
        </h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Drop in the images you already have — boot, vendor_boot, init_boot, dtbo, super,
          system — as .img or .bin. gzip, xz and lz4 are unwrapped automatically, including
          double-wrapped files. You do not need to know the layout: the headers are read
          and the build requirements follow from them.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-cyan-400 bg-cyan-500/10'
            : 'border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/60'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-slate-300">
            <Loader2 className="w-7 h-7 animate-spin text-cyan-400" />
            <div className="text-sm font-semibold">
              dissecting{progress ? ` ${progress.done}/${progress.total}` : '…'}
            </div>
            <div className="text-[11px] text-slate-500">reading containers, then headers</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <FileArchive className="w-8 h-8 text-slate-500" />
            <div className="text-sm font-semibold text-slate-300">
              drop firmware images here, or click to choose
            </div>
            <div className="text-[11px] text-slate-500">
              .img / .bin · gzip, xz, lz4, or already raw
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 flex items-start gap-2">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {device && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-cyan-500/20 flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-cyan-200 flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              what these images tell us
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              {device.gki !== 'unknown' && (
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200">{device.gki}</span>
              )}
              {device.headerVersion && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  hdr v{device.headerVersion}
                </span>
              )}
              {device.arch && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{device.arch}</span>
              )}
            </div>
          </div>
          <div className="px-4 py-3 space-y-2">
            {device.facts.length > 0 && (
              <ul className="space-y-1">
                {device.facts.map((f, i) => (
                  <li key={i} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
            {device.warnings.map((w, i) => (
              <div key={i} className="text-[11px] text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {w}
              </div>
            ))}
            {device.nextSteps.length > 0 && (
              <div className="pt-2 border-t border-cyan-500/15 space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-cyan-300/70">
                  build implications
                </div>
                {device.nextSteps.map((n, i) => (
                  <div key={i} className="text-[11px] text-slate-300 flex items-start gap-1.5">
                    <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-cyan-400" />
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((r) => (
            <div key={r.name} className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="px-3 py-2 bg-slate-900/70 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {r.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  )}
                  <span className="text-xs font-mono text-slate-200 truncate">{r.name}</span>
                  <span className="text-[11px] text-slate-500">{humanBytes(r.bytes)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {r.container && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${COMPRESSION_BADGE[r.container] ?? COMPRESSION_BADGE.unknown}`}>
                      {r.container}
                    </span>
                  )}
                  {r.kind && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                      {r.kind}
                    </span>
                  )}
                </div>
              </div>

              <div className="px-3 py-2 space-y-1.5">
                {r.error && <div className="text-[11px] text-rose-300">{r.error}</div>}

                {r.layers && r.layers.length > 1 && (
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
                    <Layers className="w-3 h-3 text-slate-500" />
                    {r.layers.map((l) => l.container).join(' → ')}
                    <span className="text-slate-600">
                      ({humanBytes(r.bytes)} → {humanBytes(r.unpackedBytes)})
                    </span>
                  </div>
                )}

                {r.boot && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-slate-500">kernel</div>
                      <div className="text-[11px] font-mono text-slate-300">
                        {humanBytes(r.boot.kernel.size)} · {r.boot.kernel.compression}
                      </div>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-slate-500">ramdisk</div>
                      <div className="text-[11px] font-mono text-slate-300">
                        {humanBytes(r.boot.ramdisk.size)} · {r.boot.ramdisk.compression}
                      </div>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-slate-500">page size</div>
                      <div className="text-[11px] font-mono text-slate-300">{r.boot.pageSize}</div>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-slate-500">header</div>
                      <div className="text-[11px] font-mono text-slate-300">
                        v{r.boot.headerVersion} {r.boot.kind}
                      </div>
                    </div>
                  </div>
                )}

                {r.boot?.fragments && r.boot.fragments.length > 0 && (
                  <div className="rounded border border-slate-800 overflow-hidden">
                    <div className="px-2 py-1 bg-slate-900/70 text-[10px] uppercase tracking-wide text-slate-500">
                      vendor ramdisk fragments
                    </div>
                    {r.boot.fragments.map((f, i) => (
                      <div key={i} className="px-2 py-1 flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-slate-300 flex-1 truncate">{f.name || `#${i}`}</span>
                        <span className="text-slate-500">{humanBytes(f.size)}</span>
                        <span className="text-slate-600">{f.compression}</span>
                      </div>
                    ))}
                  </div>
                )}

                {r.boot?.cmdline && (
                  <div className="text-[11px] font-mono text-slate-500 break-all">
                    cmdline: {r.boot.cmdline}
                  </div>
                )}

                {r.notes && r.notes.length > 0 && (
                  <div className="space-y-0.5">
                    {r.notes.map((n, i) => (
                      <div key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                        <Info className="w-3 h-3 mt-0.5 shrink-0" />
                        {n}
                      </div>
                    ))}
                  </div>
                )}

                {r.savedPath && (
                  <div className="text-[10px] font-mono text-slate-600 break-all">
                    kept at {r.savedPath}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
