/**
 * The assistant, the VM it runs on, and voice input.
 *
 * These are one component because they are one story: you ask a question, the
 * question goes to a model that lives on a VM, and the model is reached through
 * a tunnel the terminal owns. Splitting them into three panels would hide the
 * part people actually get stuck on — which machine, and is it connected.
 *
 * Design decisions worth knowing:
 *
 *   The local engine always answers first. Its answers are a diagnosis with a
 *   test attached, and are more trustworthy than a fluent paragraph. The model
 *   is shown underneath when it has something to add.
 *
 *   Settings is a real tab, not a modal, because endpoint and model configuration
 *   is something you come back to. A modal that closes loses the state of what
 *   you were doing.
 *
 *   Voice records WAV in the browser and uploads it. The browser encodes; the VM
 *   transcribes. That keeps ffmpeg off both machines.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  Mic,
  Square,
  Send,
  Server,
  Plug,
  Plus,
  Trash2,
  Download,
  Play,
  Cpu,
  HardDrive,
  RefreshCw,
  Workflow,
  GitMerge,
  Wrench,
  Network,
  Sparkles,
} from 'lucide-react';

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

const FIELD =
  'w-full bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50';
const BTN = 'text-[10px] px-2 py-1 rounded border border-[#1e293b] text-slate-400 hover:text-white disabled:opacity-30';

/* ------------------------------------------------------------------ */
/* Voice                                                              */
/* ------------------------------------------------------------------ */

/**
 * Record from the microphone and hand back 16-bit PCM WAV.
 *
 * WAV rather than the browser's default webm, because whisper.cpp on the VM only
 * reads wav/mp3/ogg/flac and there is no ffmpeg there to convert. Encoding WAV
 * in the browser is ~40 lines and removes a whole dependency from the server.
 *
 * The recorder caps at 60 s: long dictation makes transcription slow on a CPU
 * model and people rarely mean to say more than a sentence into a prompt box.
 */
function useVoice(base: string, onText: (text: string) => void) {
  const [supported] = useState(() => {
    if (typeof navigator === 'undefined') return false;
    return !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  });
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopAtRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const upload = useCallback(
    async (blob: Blob) => {
      setTranscribing(true);
      setError(null);
      try {
        const buf = await blob.arrayBuffer();
        // Convert to base64 without blowing the stack on a big array.
        let binary = '';
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
        }
        const d = await api(`${base}/vm/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: btoa(binary), mime: 'audio/wav' }),
        });
        if (d.text) onText(d.text);
        else setError('the VM heard nothing it could transcribe');
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setTranscribing(false);
      }
    },
    [base, onText],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      streamRef.current = stream;

      // Decode through the Web Audio API so the result is a known format: the
      // recorder's own mime type is browser-specific and may be webm or ogg.
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = chunks;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        cleanup();
        setRecording(false);
        if (!blob.size) {
          setError('nothing was recorded');
          return;
        }
        try {
          const wav = await encodeWav(blob);
          await upload(wav);
        } catch (e: any) {
          setError(`could not encode the recording: ${e.message ?? e}`);
        }
      };
      rec.start();
      setRecording(true);
      setSeconds(0);
      const startedAt = Date.now();
      stopAtRef.current = startedAt + 60_000;
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        // Auto-stop: an open mic that nobody closes is a recording of a room.
        if (Date.now() >= stopAtRef.current) {
          try {
            rec.stop();
          } catch {
            /* already stopping */
          }
        }
      }, 250);
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'microphone permission was refused — allow it in the browser, or type instead'
          : (e.message ?? String(e)),
      );
      cleanup();
      setRecording(false);
    }
  }, [cleanup, upload]);

  const stop = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { supported, recording, transcribing, seconds, error, start, stop, clearError: () => setError(null) };
}

/**
 * Decode any browser audio blob into mono 16-bit WAV.
 *
 * The sample rate is deliberately forced to 16 kHz: whisper resamples to that
 * internally, so sending 44.1 kHz is four times the upload for no accuracy.
 */
async function encodeWav(blob: Blob): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    ctx.close?.();
  }

  const targetRate = 16000;
  const channels = decoded.numberOfChannels;
  const srcRate = decoded.sampleRate;
  const srcLen = decoded.length;

  // Downmix to mono first: averaging channels is what a person perceives as
  // "the sound", and it halves everything downstream.
  const mono = new Float32Array(srcLen);
  for (let c = 0; c < channels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < srcLen; i++) mono[i] += data[i] / channels;
  }

  // Linear resample to 16 kHz. Not a windowed-sinc filter, but for speech into
  // whisper the difference does not change the transcript.
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(srcLen / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(srcLen - 1, i0 + 1);
    const frac = pos - i0;
    const sample = mono[i0] * (1 - frac) + mono[i1] * frac;
    // Clamp before scaling: a clipped sample (1.4) wraps to a loud click.
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  const dataBytes = out.length * 2;
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  return new Blob([header, out.buffer], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------ */
/* Assistant                                                          */
/* ------------------------------------------------------------------ */

interface Diagnosis {
  kind: 'diagnosis';
  id: string;
  title: string;
  confidence: 'high' | 'medium';
  because: string;
  means: string;
  check: string;
  fix: string;
  seen: string;
  others: { id: string; title: string; hits: number }[];
}

export function AssistantPanel({
  base,
  getContext,
}: {
  base: string;
  /** Pulls recent terminal output, so a question about "this error" has the error. */
  getContext: () => string;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [provider, setProvider] = useState<any>(null);
  const [elapsed, setElapsed] = useState(0);

  const tickRef = useRef<number | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const d = await api(`${base}/ai/status`);
      setProvider(d.provider);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [base]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const voice = useVoice(base, (text) => {
    // Append rather than replace: dictating a second clause should not wipe the
    // first.
    setQuestion((q) => (q ? `${q} ${text}` : text));
  });

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setElapsed(0);
    const started = Date.now();
    tickRef.current = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    try {
      const d = await api(`${base}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          context: includeContext ? getContext() : null,
          useModel: true,
        }),
      });
      setResult(d);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setBusy(false);
    }
  }, [question, includeContext, getContext, base]);

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
    },
    [],
  );

  const local: Diagnosis | null = result?.local ?? null;
  const modelAnswer: string | null = result?.model?.answer ?? null;

  return (
    <div className="space-y-3">
      {voice.error && (
        <div className="text-[10px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">{voice.error}</span>
          <button onClick={voice.clearError} className="text-rose-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-cyan-400" />
            {provider?.configured ? (
              <>
                model via <span className="text-cyan-300">{provider.source === 'vm-tunnel' ? 'VM tunnel' : 'env'}</span>
                {provider.model && <span className="font-mono text-slate-500">{provider.model}</span>}
              </>
            ) : (
              <span className="text-amber-300">local knowledge only — {provider?.howTo}</span>
            )}
          </div>
          <button onClick={loadStatus} className={BTN} title="re-check the provider">
            <RefreshCw className="w-3 h-3 inline" />
          </button>
        </div>

        <div className="mt-2 flex items-end gap-1.5">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. A prompt box that needs a
              // mouse to submit is annoying for the way people actually type.
              if (e.key === 'Enter' && !e.shiftKey && !busy) {
                e.preventDefault();
                ask();
              }
            }}
            rows={2}
            placeholder={
              voice.recording
                ? 'listening…'
                : 'What failed? Paste the error, or hold the mic and describe it.'
            }
            className="flex-1 bg-[#0b1220] border border-[#1e293b] rounded px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 resize-y"
          />

          {voice.supported && (
            <button
              onClick={voice.recording ? voice.stop : voice.start}
              disabled={busy}
              title={voice.recording ? 'stop and transcribe' : 'record a question'}
              className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-2 rounded border ${
                voice.recording
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                  : 'border-[#1e293b] text-slate-300 hover:text-white'
              } disabled:opacity-40`}
            >
              {voice.transcribing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : voice.recording ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
              {voice.recording ? `${voice.seconds}s` : voice.transcribing ? '…' : ''}
            </button>
          )}

          <button
            onClick={ask}
            disabled={busy || !question.trim()}
            className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px] font-bold px-3 py-2 rounded"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Ask
          </button>
        </div>

        <div className="mt-1.5 flex items-center justify-between flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              className="accent-cyan-500"
            />
            attach recent terminal output
          </label>
          {busy && (
            <span className="text-[10px] text-slate-500">
              thinking{elapsed ? ` · ${elapsed}s` : ''} — a local 7B on CPU takes a while
            </span>
          )}
        </div>
      </section>

      {error && (
        <div className="text-[10px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {result?.unmatched && (
        <div className="text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded p-2.5">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-3 h-3" /> No match in the local knowledge base
          </div>
          <div className="mt-1 text-slate-300">
            Rather than guess, here is what would help: paste the exact error line, or open Settings and connect a VM
            with a model.
          </div>
          {(result.followUp ?? []).map((f: string, i: number) => (
            <div key={i} className="mt-1 text-slate-400 font-mono text-[9px]">
              · {f}
            </div>
          ))}
        </div>
      )}

      {local && (
        <section className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-bold text-emerald-200">{local.title}</h4>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${
                local.confidence === 'high'
                  ? 'border-emerald-500/40 text-emerald-300'
                  : 'border-amber-500/40 text-amber-300'
              }`}
            >
              {local.confidence} confidence
            </span>
          </div>
          <div className="text-[9px] text-slate-500 font-mono">{local.because}</div>

          <div className="space-y-1.5">
            <Row label="what it means" value={local.means} />
            <Row label="check it with" value={local.check} mono />
            <Row label="fix" value={local.fix} />
            {local.seen && <Row label="seen before" value={local.seen} muted />}
          </div>

          {local.others?.length > 0 && (
            <div className="text-[9px] text-slate-500">
              also possible: {local.others.map((o) => o.title).join(' · ')}
            </div>
          )}
        </section>
      )}

      {modelAnswer && (
        <section className="border border-cyan-500/30 bg-cyan-500/5 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-cyan-300 font-bold">
            <Cpu className="w-3 h-3" /> model
            {provider?.model && <span className="font-mono text-cyan-600/70">{provider.model}</span>}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-200 whitespace-pre-wrap leading-relaxed">{modelAnswer}</div>
        </section>
      )}

      {result?.modelError && (
        <div className="text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded p-2">
          the model did not answer: {result.modelError}
        </div>
      )}

      {result?.evidence?.length > 0 && (
        <section className="border border-[#1e293b] bg-[#0b1220] rounded-xl p-2.5">
          <div className="text-[9px] text-slate-500">lines from your terminal that looked like errors</div>
          {result.evidence.map((e: string, i: number) => (
            <div key={i} className="text-[9px] font-mono text-rose-300/80 truncate">
              {e}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Row({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div>
      <div className="text-[9px] text-slate-500">{label}</div>
      <div
        className={`text-[11px] leading-relaxed ${mono ? 'font-mono text-emerald-300 break-all' : muted ? 'text-slate-400' : 'text-slate-200'}`}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VM settings                                                        */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  { id: 'azure', label: 'Azure', hint: 'user@<vm-public-ip>, key in ~/.ssh' },
  { id: 'aws', label: 'AWS', hint: 'ubuntu@<ec2-public-dns>, .pem key' },
  { id: 'ibm', label: 'IBM Cloud', hint: 'root@<vsi-public-ip>' },
  { id: 'lightning', label: 'Lightning AI', hint: 'ssh host from the Studio — usually a tailscale name' },
  { id: 'oracle', label: 'Oracle Cloud', hint: 'opc@<instance-public-ip>, the .key from the instance' },
  { id: 'daytona', label: 'Daytona', hint: 'the workspace ssh host' },
  { id: 'tailscale', label: 'Tailscale', hint: '100.x.y.z or a MagicDNS name — works from anywhere' },
  { id: 'cloudflare', label: 'Cloudflare (Tunnel)', hint: 'ssh to the tunnel hostname, e.g. box.example.com' },
  { id: 'gcp', label: 'GCP', hint: 'user@<external-ip>' },
  { id: 'gitlab', label: 'GitLab CI runner', hint: 'gitlab.com/<group>/<project> — a runner, not ssh' },
  { id: 'colab', label: 'Google Colab', hint: 'the ssh host from the notebook — session-scoped, dies when idle' },
  { id: 'kaggle', label: 'Kaggle', hint: 'the ssh host from the notebook — session-scoped, dies when idle' },
  { id: 'runcode', label: 'RunCode', hint: 'the sandbox ssh host' },
  { id: 'railway', label: 'Railway', hint: 'the service ssh host' },
  { id: 'vercel', label: 'Vercel', hint: 'deploy target, not a shell host' },
  { id: 'homelab', label: 'Homelab', hint: '10.0.0.x or a tailscale name' },
  { id: 'other', label: 'Other', hint: 'any ssh-reachable host' },
];

/**
 * One machine, with its own addresses.
 *
 * The two slots are drawn the same way because they are the same thing with a
 * different job — that sameness is the point. A third machine later is another
 * card, not another code path.
 */
function ConnectionCard({
  base,
  conn,
  purpose,
  onChanged,
}: {
  base: string;
  conn: any;
  purpose: any;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState({ host: '', user: '', label: '', kind: 'public' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<any>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [progress, setProgress] = useState<any>(null);
  const [provider, setProvider] = useState(conn.provider ?? 'other');
  const [pathsOpen, setPathsOpen] = useState(false);
  const [paths, setPaths] = useState(conn.paths ?? {});

  const isModel = conn.purpose === 'model';
  const active = conn.active;
  const tunnelUp = conn.tunnel?.up === true;

  const act = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      setError(null);
      try {
        await fn();
        await onChanged();
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const loadModels = useCallback(async () => {
    if (!isModel) return;
    try {
      const m = await api(`${base}/vm/connections/${conn.id}/models`);
      setModels(m.ok ? m : null);
    } catch {
      setModels(null);
    }
  }, [base, conn.id, isModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    setProvider(conn.provider ?? 'other');
    setPaths(conn.paths ?? {});
  }, [conn.provider, conn.paths]);

  // Poll an in-flight download. Bytes on disk is the honest signal: curl's own
  // progress output is not a stable number to parse.
  useEffect(() => {
    if (!progress?.fileName) return;
    const t = setInterval(async () => {
      try {
        const d = await api(`${base}/vm/connections/${conn.id}/models/download/${encodeURIComponent(progress.fileName)}`);
        setProgress(d);
        if (d.done) {
          clearInterval(t);
          loadModels();
        }
      } catch {
        /* transient; keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [progress?.fileName, base, conn.id, loadModels]);

  const addEndpoint = () =>
    act('add', async () => {
      await api(`${base}/vm/connections/${conn.id}/endpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm({ host: '', user: '', label: '', kind: 'public' });
    });

  const saveMeta = () =>
    act('meta', async () => {
      await api(`${base}/vm/connections/${conn.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, paths }),
      });
    });

  const probeNow = () =>
    act('probe', async () => {
      await api(`${base}/vm/connections/${conn.id}/probe`);
    });

  const tunnel = (on: boolean) =>
    act('tunnel', async () => {
      await api(`${base}/vm/connections/${conn.id}/tunnel`, { method: on ? 'POST' : 'DELETE' });
    });

  return (
    <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
            <Server className={`w-3.5 h-3.5 ${isModel ? 'text-cyan-400' : 'text-violet-400'}`} />
            {purpose.label}
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded border font-normal ${
                conn.endpoints.length
                  ? active
                    ? 'border-emerald-500/40 text-emerald-300'
                    : 'border-amber-500/40 text-amber-300'
                  : 'border-[#1e293b] text-slate-500'
              }`}
            >
              {conn.endpoints.length ? (active ? (active.lastProbe?.reachable ? 'reachable' : 'unproved') : 'no address active') : 'not set up'}
            </span>
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5 max-w-xl">{purpose.detail}</p>
        </div>
        {isModel && (
          <div className={`text-[9px] ${tunnelUp ? 'text-emerald-300' : 'text-slate-500'}`}>
            {tunnelUp ? `tunnel up on 127.0.0.1:${conn.tunnelPort}` : 'no tunnel'}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 text-[10px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* addresses */}
      {conn.endpoints.length > 0 && (
        <div className="mt-2 space-y-1">
          {conn.endpoints.map((ep: any) => {
            const on = ep.id === conn.activeId;
            const lp = ep.lastProbe;
            return (
              <div
                key={ep.id}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 border ${
                  on ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-[#1e293b] bg-[#0b1220]'
                }`}
              >
                <button
                  onClick={() =>
                    act('activate', async () => {
                      await api(`${base}/vm/connections/${conn.id}/activate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: ep.id }),
                      });
                    })
                  }
                  className="min-w-0 text-left flex items-center gap-2 flex-wrap"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                  <span className="text-[11px] text-white truncate">{ep.label || ep.host}</span>
                  <span className="text-[9px] font-mono text-slate-500">
                    {ep.user}@{ep.host}
                  </span>
                  <span className="text-[9px] text-slate-500">{ep.kind}</span>
                  {lp && (
                    <span className={`text-[9px] ${lp.reachable ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {lp.reachable ? `${lp.latencyMs}ms` : 'unreachable'}
                    </span>
                  )}
                </button>
                <button
                  onClick={() =>
                    act('delete', async () => {
                      await api(`${base}/vm/connections/${conn.id}/endpoints/${ep.id}`, { method: 'DELETE' });
                    })
                  }
                  className="text-slate-600 hover:text-rose-400 shrink-0"
                  title="remove this address"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* add an address */}
      <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-1.5 items-end">
        <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
          host
          <input
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder={PROVIDERS.find((p) => p.id === provider)?.hint.split('@')[1] ?? '10.0.0.5'}
            className={FIELD}
          />
        </label>
        <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
          user
          <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="ubuntu" className={FIELD} />
        </label>
        <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
          label
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="home" className={FIELD} />
        </label>
        <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
          kind
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={FIELD}>
            <option value="public">public</option>
            <option value="lan">lan</option>
            <option value="tunnel">tunnel</option>
          </select>
        </label>
        <button
          onClick={addEndpoint}
          disabled={busy === 'add' || !form.host || !form.user}
          className="flex items-center justify-center gap-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-[10px] font-bold px-2 py-2 rounded"
        >
          {busy === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="bg-[#0b1220] border border-[#1e293b] rounded px-1.5 py-1 text-[10px] text-slate-300"
          title="where this machine runs"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button onClick={saveMeta} disabled={busy === 'meta'} className={BTN}>
          save
        </button>

        <button onClick={probeNow} disabled={!active || busy === 'probe'} className={BTN}>
          {busy === 'probe' && <Loader2 className="w-3 h-3 inline animate-spin" />} probe
        </button>

        {isModel &&
          (tunnelUp ? (
            <button onClick={() => tunnel(false)} disabled={busy === 'tunnel'} className={BTN}>
              <Plug className="w-3 h-3 inline" /> close tunnel
            </button>
          ) : (
            <button
              onClick={() => tunnel(true)}
              disabled={!active || busy === 'tunnel'}
              className="text-[10px] px-2 py-1 rounded border border-cyan-500/40 text-cyan-300 hover:text-white disabled:opacity-30"
            >
              {busy === 'tunnel' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <Plug className="w-3 h-3 inline" />} open
              tunnel
            </button>
          ))}

        <button onClick={() => setPathsOpen((v) => !v)} className={BTN}>
          paths
        </button>
      </div>

      {pathsOpen && (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 border border-[#1e293b] rounded p-2 bg-[#0b1220]">
          {(isModel
            ? (['models', 'llama', 'whisper', 'whisperModel'] as const)
            : (['models'] as const)
          ).map((k) => (
            <label key={k} className="text-[9px] text-slate-500 flex flex-col gap-0.5">
              {k}
              <input
                value={paths[k] ?? ''}
                onChange={(e) => setPaths({ ...paths, [k]: e.target.value })}
                className={`${FIELD} font-mono`}
              />
            </label>
          ))}
          <div className="col-span-2 text-[9px] text-slate-500">
            absolute paths on the remote machine; they become commands, so they must start with /
          </div>
        </div>
      )}

      {active?.lastProbe && (
        <div className="mt-2 border border-[#1e293b] rounded p-2 bg-[#0b1220]">
          {active.lastProbe.reachable ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[10px]">
              <Fact icon={<Server className="w-3 h-3" />} label="host" value={active.lastProbe.hostname} />
              <Fact icon={<Cpu className="w-3 h-3" />} label="cores" value={String(active.lastProbe.cores)} />
              <Fact icon={<Cpu className="w-3 h-3" />} label="ram" value={`${active.lastProbe.ramGb} GB`} />
              <Fact icon={<HardDrive className="w-3 h-3" />} label="disk free" value={active.lastProbe.diskFree} />
              {isModel ? (
                <>
                  <Fact label="llama.cpp" value={active.lastProbe.llama ? 'installed' : 'missing'} ok={active.lastProbe.llama} />
                  <Fact label="whisper" value={active.lastProbe.whisper ? 'installed' : 'missing'} ok={active.lastProbe.whisper} />
                  <Fact label="speech model" value={active.lastProbe.speechModel ? 'present' : 'missing'} ok={active.lastProbe.speechModel} />
                  <Fact label="server" value={active.lastProbe.serverUp ? 'running' : 'stopped'} ok={active.lastProbe.serverUp} />
                </>
              ) : (
                <>
                  <Fact label="git" value={active.lastProbe.git} ok={!!active.lastProbe.git && active.lastProbe.git !== 'missing'} />
                  <Fact label="make" value={active.lastProbe.make ? 'installed' : 'missing'} ok={active.lastProbe.make} />
                  <Fact label="gcc" value={active.lastProbe.gcc ? 'installed' : 'missing'} ok={active.lastProbe.gcc} />
                  <Fact label="cwd" value={active.lastProbe.cwd} />
                </>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-rose-300">unreachable: {active.lastProbe.error}</div>
          )}
        </div>
      )}

      {conn.tunnel?.stderr && !tunnelUp && isModel && (
        <div className="mt-1 text-[9px] font-mono text-rose-300/70 break-all">{conn.tunnel.stderr}</div>
      )}

      {/* models, model connection only */}
      {isModel && active && (
        <div className="mt-2 border-t border-[#1e293b] pt-2">
          <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <HardDrive className="w-3 h-3 text-cyan-400" /> models
            {models?.dir && <span className="font-mono text-slate-600 text-[9px]">{models.dir}</span>}
          </div>

          {models?.models?.length > 0 ? (
            <div className="mt-1 space-y-1">
              {models.models.map((m: any) => (
                <div key={m.path} className="flex items-center justify-between gap-2 border border-[#1e293b] rounded px-2 py-1 bg-[#0b1220]">
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-200 font-mono truncate">{m.name}</div>
                    <div className="text-[9px] text-slate-500">{(m.bytes / 1073741824).toFixed(2)} GB</div>
                  </div>
                  <button
                    onClick={() =>
                      act('start', async () => {
                        await api(`${base}/vm/connections/${conn.id}/models/start`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: m.path }),
                        });
                        await loadModels();
                      })
                    }
                    disabled={busy === 'start'}
                    className="text-[10px] px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-300 hover:text-white disabled:opacity-40 shrink-0"
                  >
                    {busy === 'start' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <Play className="w-3 h-3 inline" />} load
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[9px] text-slate-500 mt-0.5">
              {models ? 'no .gguf files found — download one below' : 'checking…'}
            </div>
          )}

          <div className="mt-1.5 flex items-end gap-1.5">
            <input
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://huggingface.co/…/resolve/main/model-Q4_K_M.gguf"
              className={`${FIELD} font-mono flex-1`}
            />
            <button
              onClick={() =>
                act('download', async () => {
                  const d = await api(`${base}/vm/connections/${conn.id}/models/download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: downloadUrl.trim() }),
                  });
                  setProgress({ fileName: d.fileName, bytes: 0 });
                })
              }
              disabled={busy === 'download' || !downloadUrl.trim()}
              className="flex items-center gap-1 bg-[#1e293b] hover:bg-[#273449] disabled:opacity-40 text-white text-[10px] font-bold px-2 py-2 rounded shrink-0"
            >
              {busy === 'download' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Fetch
            </button>
          </div>

          {progress && (
            <div className="mt-1 text-[9px] text-slate-400 flex items-center justify-between">
              <span className="font-mono truncate">{progress.fileName}</span>
              <span>{(progress.bytes / 1073741824).toFixed(2)} GB</span>
            </div>
          )}

          <div className="mt-1 text-[9px] text-slate-500">
            Downloads run on this machine and never pass through the workspace.
          </div>
        </div>
      )}

      {!active && (
        <div className="mt-2 text-[9px] text-amber-300/80">add an address above to connect this machine</div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Model providers (API)                                              */
/* ------------------------------------------------------------------ */

/**
 * Where a model answer comes from, when it is not a GGUF on a VM.
 *
 * Shown as a real choice rather than a buried env var because the two options
 * fail differently and cost differently, and that is the thing worth seeing:
 * a local model is free and private but slow on a CPU; an API is fast and costs
 * per token. The key is write-only here — the server tells us whether it has one
 * and the last four characters, never the key itself.
 */
export function ModelProviderPanel({ base, onChanged }: { base: string; onChanged?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preset, setPreset] = useState('openrouter');
  const [form, setForm] = useState({ base: '', model: '', key: '', label: '' });
  const [test, setTest] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`${base}/vm/providers`);
      setData(d);
      // Default the form to the preset's first model, so adding one is two fields.
      const p = d.presets.find((x: any) => x.id === preset);
      if (p && !form.model) setForm((f) => ({ ...f, base: p.base, model: p.models[0] ?? '' }));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [base, preset, form.model]);

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
        onChanged?.();
      } catch (e: any) {
        setError(e.message ?? String(e));
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged],
  );

  const p = data?.presets?.find((x: any) => x.id === preset);

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[10px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {(data?.providers ?? []).length > 0 && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
          <h3 className="text-xs font-bold text-white">API providers</h3>
          <div className="mt-1.5 space-y-1">
            {data.providers.map((pr: any) => {
              const on = pr.id === data.activeId;
              return (
                <div
                  key={pr.id}
                  className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 border ${
                    on ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-[#1e293b] bg-[#0b1220]'
                  }`}
                >
                  <button
                    onClick={() =>
                      act('activate', async () => {
                        await api(`${base}/vm/providers/${pr.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ activate: true }),
                        });
                      })
                    }
                    className="min-w-0 text-left"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                      <span className="text-[11px] text-white">{pr.label}</span>
                      <span className="text-[9px] font-mono text-slate-500">{pr.model}</span>
                      {pr.hasKey && <span className="text-[9px] text-slate-500">{pr.keyHint}</span>}
                      {pr.lastTest && (
                        <span className={`text-[9px] ${pr.lastTest.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {pr.lastTest.ok ? `tested ${pr.lastTest.latencyMs}ms` : 'test failed'}
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-slate-500 font-mono truncate">{pr.base}</div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() =>
                        act(`test-${pr.id}`, async () => {
                          const r = await api(`${base}/vm/providers/${pr.id}/test`, { method: 'POST' });
                          setTest({ id: pr.id, ...r });
                        })
                      }
                      disabled={busy === `test-${pr.id}`}
                      className={BTN}
                    >
                      {busy === `test-${pr.id}` ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} test
                    </button>
                    <button
                      onClick={() =>
                        act('remove', async () => {
                          await api(`${base}/vm/providers/${pr.id}`, { method: 'DELETE' });
                        })
                      }
                      className="text-slate-600 hover:text-rose-400"
                      title="remove this provider and its key"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {test && (
            <div className={`mt-1.5 text-[10px] ${test.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {test.ok ? `answered in ${test.latencyMs}ms: "${test.answer}"` : `failed: ${test.error}`}
            </div>
          )}
        </section>
      )}

      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-cyan-400" /> Add a provider
        </h3>

        <div className="mt-1.5 flex flex-wrap gap-1">
          {(data?.presets ?? []).map((x: any) => (
            <button
              key={x.id}
              onClick={() => {
                setPreset(x.id);
                setForm({ base: x.base, model: x.models[0] ?? '', key: '', label: '' });
              }}
              className={`text-[10px] px-2 py-1 rounded border ${
                preset === x.id ? 'border-cyan-500/50 text-cyan-200 bg-cyan-500/5' : 'border-[#1e293b] text-slate-400 hover:text-white'
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>

        {p && <div className="mt-1.5 text-[10px] text-slate-400">{p.detail}</div>}

        <div className="mt-2 space-y-1.5">
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            base URL
            <input
              value={form.base}
              onChange={(e) => setForm({ ...form, base: e.target.value })}
              placeholder="https://openrouter.ai/api/v1"
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            model
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder={p?.models?.[0] ?? 'model id'}
              list={`models-${preset}`}
              className={`${FIELD} font-mono`}
            />
            <datalist id={`models-${preset}`}>
              {(p?.models ?? []).map((m: string) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="text-[9px] text-slate-500 flex flex-col gap-0.5">
            API key {p?.needs ? <span className="text-slate-600">— {p.needs}</span> : null}
            <input
              type="password"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              placeholder="sk-…"
              autoComplete="off"
              className={`${FIELD} font-mono`}
            />
          </label>
          <button
            onClick={() =>
              act('add', async () => {
                await api(`${base}/vm/providers`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ preset, ...form }),
                });
                setForm({ ...form, key: '' });
              })
            }
            disabled={busy === 'add' || !form.model || !form.key || !form.base}
            className="w-full flex items-center justify-center gap-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-[11px] font-bold px-3 py-2 rounded"
          >
            {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
            Add provider
          </button>
        </div>

        <div className="mt-1.5 text-[9px] text-slate-500">
          The key is stored on this machine in a file only you can read, and is never sent back to the page.
        </div>

        {data?.note && <div className="mt-1.5 text-[9px] text-slate-500 italic">{data.note}</div>}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Connect router                                                     */
/* ------------------------------------------------------------------ */

/**
 * The join, made visible.
 *
 * Two things were separately true: the terminal knows which machines exist, and
 * the platform knows where builds go. A person should not have to hold both in
 * their head, so this panel states the relationship in one line and offers the
 * single next action.
 *
 * Publishing and routing are separate buttons on purpose. A tool that publishes
 * a runner and silently reroutes every build in one click has made a decision
 * the user did not — and the first they hear of it is a build on the wrong box.
 */
export function ConnectRouterPanel({ base, onOpenSettings }: { base: string; onOpenSettings: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(120);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`${base}/connect`));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [base]);

  useEffect(() => {
    load();
    // Routing has a deadline, so the panel would show a stale "temporary" long
    // after it expired. Refreshing is cheap; a wrong status is not.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      setError(null);
      setNote(null);
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

  const bridge = data?.bridge;
  const engine = data?.connections?.find((c: any) => c.purpose === 'engine');
  const model = data?.connections?.find((c: any) => c.purpose === 'model');
  const effective = data?.routing?.effective;
  const temporary = data?.routing?.temporary;

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[10px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {data?.routingError && (
        <div className="text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded p-2">
          could not read the build router: {data.routingError}
        </div>
      )}

      {/* the two machines and what they do */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Answers
            </h3>
            <span className={`text-[9px] ${model?.reachable ? 'text-emerald-300' : 'text-slate-500'}`}>
              {model?.reachable ? 'connected' : 'not connected'}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">the model machine</div>
          <div className="mt-1.5 text-[10px] font-mono text-slate-300 truncate">
            {model?.activeAddress ?? 'no address set'}
          </div>
          <div className="text-[9px] text-slate-500">
            {data?.model?.modelName ?? 'no model loaded'}
            {data?.model?.tunnelUp ? ` · tunnel :${data.model.tunnelPort}` : ' · no tunnel — the assistant has no model'}
          </div>
        </div>

        <div className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-violet-400" /> Builds
            </h3>
            <span className={`text-[9px] ${bridge?.routeUsesEngineConnection ? 'text-emerald-300' : 'text-slate-500'}`}>
              {bridge?.routeUsesEngineConnection ? 'builds go here' : 'idle'}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">the build engine machine</div>
          <div className="mt-1.5 text-[10px] font-mono text-slate-300 truncate">
            {engine?.activeAddress ?? 'no address set'}
          </div>
          <div className="text-[9px] text-slate-500">
            {engine?.addresses?.length ?? 0} address{(engine?.addresses?.length ?? 0) === 1 ? '' : 'es'} ·{' '}
            {bridge?.published ? (bridge.inSync ? 'published and in sync' : 'published, out of date') : 'not published as a runner'}
          </div>
        </div>
      </div>

      {/* the single next step */}
      {bridge?.nextStep && (
        <div className="text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded p-2.5 flex items-start justify-between gap-2">
          <span>
            <b>next:</b> {bridge.nextStep}
          </span>
          {!engine?.addresses?.length && (
            <button onClick={onOpenSettings} className="text-amber-300 underline shrink-0">
              open settings
            </button>
          )}
        </div>
      )}

      {bridge?.drift && (
        <div className="text-[10px] bg-[#0b1220] border border-amber-500/30 rounded p-2">
          <div className="text-amber-200 font-bold">the two lists disagree</div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            terminal: <span className="font-mono">{bridge.drift.terminal.join(', ') || 'none'}</span>
          </div>
          <div className="text-[9px] text-slate-400">
            build runner: <span className="font-mono">{bridge.drift.runner.join(', ') || 'none'}</span>
          </div>
        </div>
      )}

      {/* where builds currently go */}
      <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
        <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
          <Workflow className="w-3.5 h-3.5 text-emerald-400" /> Where the next build goes
        </h3>

        {data?.routing ? (
          <>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-white font-mono">{effective?.target ?? 'not set'}</span>
              {effective?.runnerId && <span className="text-[9px] text-slate-500 font-mono">{effective.runnerId}</span>}
              {effective?.temporary && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300">
                  temporary until {new Date(effective.expiresAt).toLocaleString()}
                </span>
              )}
              {bridge?.routeUsesEngineConnection && (
                <span className="text-[9px] text-emerald-300">this is the machine above</span>
              )}
            </div>

            {temporary && (
              <div className="mt-1 text-[9px] text-slate-500">
                a standing route is stored underneath and resumes when the temporary one expires
              </div>
            )}

            {(data.routing.warnings ?? []).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {data.routing.warnings.map((w: string, i: number) => (
                  <div key={i} className="text-[9px] text-amber-300/80">
                    · {w}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() =>
                  act('publish', async () => {
                    const r = await api(`${base}/connect/publish`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({}),
                    });
                    setNote(r.note);
                  })
                }
                disabled={!engine?.addresses?.length || busy === 'publish'}
                className="text-[10px] px-2 py-1 rounded border border-violet-500/40 text-violet-300 hover:text-white disabled:opacity-30"
              >
                {busy === 'publish' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <GitMerge className="w-3 h-3 inline" />}{' '}
                {bridge?.published ? 'republish runner' : 'publish as runner'}
              </button>

              <button
                onClick={() =>
                  act('route', async () => {
                    const r = await api(`${base}/connect/route`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({}),
                    });
                    setNote(r.note ?? 'build route set to this machine');
                  })
                }
                disabled={!bridge?.published || busy === 'route' || bridge?.routeUsesEngineConnection}
                className="text-[10px] px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:text-white disabled:opacity-30"
              >
                {busy === 'route' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <Play className="w-3 h-3 inline" />} send
                builds here
              </button>

              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className="w-16 bg-[#0b1220] border border-[#1e293b] rounded px-1.5 py-1 text-[10px] text-slate-300"
                  title="minutes"
                />
                <button
                  onClick={() =>
                    act('temp', async () => {
                      const r = await api(`${base}/connect/route`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ minutes }),
                      });
                      setNote(`temporary until ${new Date(r.expiresAt).toLocaleString()}, then the standing route resumes`);
                    })
                  }
                  disabled={!bridge?.published || busy === 'temp' || !(minutes > 0)}
                  className="text-[10px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:text-white disabled:opacity-30"
                >
                  {busy === 'temp' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} for {minutes}m
                </button>
              </div>

              <button
                onClick={() =>
                  act('clear', async () => {
                    const r = await api(`${base}/connect/route/clear`, { method: 'POST' });
                    setNote(r.clearedTemporary ? 'temporary route cleared; build route is local' : 'build route is local');
                  })
                }
                disabled={busy === 'clear' || (effective?.target === 'local' && !temporary)}
                className={BTN}
              >
                {busy === 'clear' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} back to local
              </button>
            </div>

            {note && <div className="mt-1.5 text-[9px] text-emerald-300">{note}</div>}
          </>
        ) : (
          <div className="text-[10px] text-slate-500 mt-1">the build router did not answer</div>
        )}
      </section>

      {/* all runners, including ones this panel did not create */}
      {(data?.routing?.runners ?? []).length > 0 && (
        <section className="border border-[#1e293b] bg-[#0f172a]/60 rounded-xl p-3">
          <h3 className="text-xs font-bold text-white">Runners the build router knows</h3>
          <div className="mt-1 space-y-0.5">
            {data.routing.runners.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between text-[10px] border border-[#1e293b] rounded px-2 py-1 bg-[#0b1220]">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1 h-1 rounded-full ${r.id === bridge?.publishedRunnerId ? 'bg-violet-400' : 'bg-slate-600'}`} />
                  <span className="text-slate-300 truncate">{r.label}</span>
                  <span className="text-[9px] text-slate-500">{r.kind}</span>
                </span>
                <span className="font-mono text-[9px] text-slate-500 truncate shrink-0">{r.address}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[9px] text-slate-500">
            Runners without a violet dot were made in the compile router tab and are left alone.
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Model source: a GGUF on a machine, or an API key.
 *
 * A switch rather than two tabs sitting side by side, because only one can be
 * answering at a time and the precedence between them is otherwise a thing
 * people have to guess. The chosen side is shown expanded, the other collapsed —
 * both stay reachable, since switching is a normal thing to do when a CPU model
 * is too slow for the question at hand.
 */
function SourceSwitch({ base }: { base: string }) {
  const [mode, setMode] = useState<'vm' | 'api' | null>(null);
  const [status, setStatus] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`${base}/ai/status`);
      setStatus(d.provider);
      // Infer the active source from what the engine says it will use.
      setMode(d.provider?.source === 'api' || String(d.provider?.source ?? '').startsWith('api:') ? 'api' : 'vm');
    } catch {
      setMode('vm');
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {(
          [
            { id: 'vm', label: 'GGUF on a VM', hint: 'free, private, slower' },
            { id: 'api', label: 'API provider', hint: 'fast, per-token cost' },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 text-left px-2.5 py-2 rounded border ${
              mode === m.id ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-[#1e293b] bg-[#0b1220] hover:border-slate-600'
            }`}
          >
            <div className="text-[11px] text-white font-bold flex items-center gap-1.5">
              {m.id === 'vm' ? <HardDrive className="w-3 h-3" /> : <Plug className="w-3 h-3" />}
              {m.label}
            </div>
            <div className="text-[9px] text-slate-500">{m.hint}</div>
          </button>
        ))}
      </div>

      <div className="text-[9px] text-slate-500 flex items-center gap-1.5">
        <Info className="w-3 h-3" />
        {status?.configured ? (
          <>
            answering from <span className="text-cyan-300">{status.source}</span>
            {status.model && <span className="font-mono">{status.model}</span>}
          </>
        ) : (
          <span className="text-amber-300">no model yet — {status?.howTo}</span>
        )}
      </div>

      {mode === 'api' && <ModelProviderPanel base={base} onChanged={load} />}
    </div>
  );
}

/**
 * Settings: two machines, each with its own addresses.
 *
 * Drawn as two cards rather than one list because the question people actually
 * ask is "which machine does what" — the model box answers, the engine box
 * builds — and a flat list of hosts loses that.
 */
export function VmSettingsPanel({ base }: { base: string }) {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setState(await api(`${base}/vm/state`));
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[10px] text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      <div className="text-[10px] text-slate-400 flex items-start gap-1.5">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        Two machines, two jobs. Either can be on any provider — Azure, AWS, IBM, or something in your house. Each keeps
        its own list of addresses so you can switch between a LAN IP and a public one without reconfiguring anything.
      </div>

      <SourceSwitch base={base} />

      {(state?.connections ?? []).map((c: any) => {
        const purpose = state.purposes.find((p: any) => p.id === c.purpose) ?? { id: c.purpose, label: c.purpose, detail: '' };
        return (
          <React.Fragment key={`${c.id}-${refreshKey}`}>
            <ConnectionCard base={base} conn={c} purpose={purpose} onChanged={load} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Fact({
  label,
  value,
  ok,
  icon,
}: {
  label: string;
  value: string;
  ok?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-600">{icon}</span>
      <span className="text-slate-500">{label}</span>
      <span
        className={
          ok === undefined ? 'text-slate-200' : ok ? 'text-emerald-300' : 'text-rose-300'
        }
      >
        {value}
      </span>
    </div>
  );
}
