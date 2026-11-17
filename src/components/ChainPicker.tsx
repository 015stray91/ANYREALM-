import React, { useEffect, useMemo, useState } from 'react';
import { Cpu, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Wrench } from 'lucide-react';

/**
 * Compiler-chain picker.
 *
 * A build does not use one compiler. AOSP uses a different one for the kernel,
 * the system image, recovery, host tools, the vendor/DSP side and the
 * bootloader, and each stage tolerates a different amount of version drift and
 * obfuscation. So this is one selector per stage, grouped by language, with the
 * kernel-shaped stages refusing obfuscator toolchains outright.
 */

export interface ServerSlot {
  id: string;
  repo: string;
  branch?: string;
  cc?: string;
  ccPath?: string;
  prefix?: string;
  label?: string;
  obfuscator?: boolean;
}

export interface StageDef {
  id: string;
  label: string;
  languages: string[];
  romPart: string;
  kernelCode: boolean;
  allowedCategories: string[];
  why: string;
}

export interface CategoryDef {
  id: string;
  label: string;
  language: string;
  kernelSafe: boolean;
  count: number;
  toolchains: Array<{
    id: string;
    name: string;
    repo: string;
    branch?: string;
    cc?: string;
    note?: string;
    obfuscator?: boolean;
    bins?: string[];
    targets?: string[];
  }>;
}

export interface ToolDef {
  id: string;
  name: string;
  repo: string;
  branch?: string;
  kind: string;
  use: string;
  builder_use: string;
}

interface Catalog {
  stages: StageDef[];
  categories: CategoryDef[];
  chains: Record<string, unknown>;
  tools: ToolDef[];
  toolsByKind: Record<string, ToolDef[]>;
  checked?: string;
}

/** Roles the generator understands, in build order. */
const ROLE_ORDER = ['bootloader', 'host', 'kernel', 'system', 'recovery', 'vendor'] as const;
type Role = (typeof ROLE_ORDER)[number];

const KIND_LABEL: Record<string, string> = {
  image: 'Image tools',
  firmware: 'Firmware extraction',
  flash: 'Flashing / EDL',
  devicetree: 'Device trees',
  kernel: 'Kernel extras',
  userspace: 'User space',
  desktop: 'Desktop',
  debug: 'Debug',
  runtime: 'Runtime',
  ci: 'CI helpers',
  other: 'Other',
};

export default function ChainPicker({
  value,
  onChange,
  tools,
  onTools,
  edition,
}: {
  value: Record<string, ServerSlot | undefined>;
  onChange: (next: Record<string, ServerSlot | undefined>) => void;
  tools: string[];
  onTools: (next: string[]) => void;
  edition: string;
}) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRole, setOpenRole] = useState<Role | null>('kernel');
  const [showTools, setShowTools] = useState(false);

  useEffect(() => {
    fetch('/api/toolchains')
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setCat(d)))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // Only the stages this edition actually compiles are worth showing. Offering
  // "recovery" on a desktop ISO is a choice with no effect, which is worse than
  // no choice at all.
  const activeRoles = useMemo<Role[]>(() => {
    if (!cat) return [];
    const compiled = new Set<Role>();
    if (edition === 'mobile_kernel') compiled.add('kernel');
    if (edition === 'rom') ['kernel', 'system', 'host'].forEach((r) => compiled.add(r as Role));
    if (edition === 'desktop_iso') ['kernel', 'bootloader', 'host', 'system'].forEach((r) => compiled.add(r as Role));
    return ROLE_ORDER.filter((r) => compiled.has(r));
  }, [edition, cat]);

  const stageFor = (role: Role): StageDef | undefined => cat?.stages.find((s) => s.id === role);

  const pick = (role: Role, toolchainId: string) => {
    const all = cat?.categories.flatMap((c) => c.toolchains) ?? [];
    const t = all.find((x) => x.id === toolchainId);
    if (!t) return;
    const slot: ServerSlot = {
      id: t.id,
      repo: t.repo.includes('/') ? t.repo : `015stray91/${t.repo}`,
      branch: t.branch,
      cc: t.cc ?? 'clang',
      label: t.name,
      obfuscator: !!t.obfuscator,
      ...(t.bins?.[0] ? { ccPath: t.bins[0] } : {}),
    };
    onChange({ ...value, [role]: slot });
  };

  if (err) {
    return (
      <div className="rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-300">
        Toolchain catalog unavailable: {err}
      </div>
    );
  }
  if (!cat) {
    return <div className="animate-pulse rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-500">Loading toolchains…</div>;
  }

  const selectedIds = new Set(Object.values(value).filter(Boolean).map((s) => s!.id));
  const anyObfuscatorOnKernel = activeRoles.some(
    (r) => stageFor(r)?.kernelCode && value[r]?.obfuscator,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
          <Cpu className="h-4 w-4 text-emerald-400" />
          Compiler chain per build stage
        </div>
        <span className="text-xs text-neutral-500">
          {cat.categories.reduce((n, c) => n + c.count, 0)} toolchains · verified {cat.checked ?? 'live'}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-neutral-500">
        Each stage can use a different compiler. The kernel, recovery and bootloader stages refuse obfuscator
        chains: their passes do not fail to compile there, they produce an image that boots partway and faults.
      </p>

      {anyObfuscatorOnKernel && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            An obfuscator is selected for a kernel-shaped stage. The composer will refuse this build. Move it to
            <strong> System / user space</strong>, where a fault kills one process instead of the kernel.
          </span>
        </div>
      )}

      {activeRoles.map((role) => {
        const stage = stageFor(role);
        const chosen = value[role];
        const open = openRole === role;
        const bad = !!stage?.kernelCode && !!chosen?.obfuscator;
        const allowed = new Set(stage?.allowedCategories ?? []);
        return (
          <div
            key={role}
            className={`overflow-hidden rounded-lg border ${bad ? 'border-amber-700/70' : 'border-neutral-800'} bg-neutral-900/60`}
          >
            <button
              type="button"
              onClick={() => setOpenRole(open ? null : role)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-800/40"
            >
              {open ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-neutral-100">{stage?.label ?? role}</span>
                  {(stage?.languages ?? []).map((l) => (
                    <span key={l} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      {l}
                    </span>
                  ))}
                  {stage?.kernelCode ? (
                    <span className="rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] text-rose-300">kernel code</span>
                  ) : (
                    <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">obfuscation safe</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-neutral-500">
                  {chosen ? (
                    <span className={bad ? 'text-amber-400' : 'text-emerald-400'}>
                      {chosen.label ?? chosen.id} · {chosen.repo}
                    </span>
                  ) : (
                    <span>default host compiler</span>
                  )}
                </div>
              </div>
            </button>

            {open && (
              <div className="border-t border-neutral-800 p-3">
                <p className="mb-3 text-xs leading-relaxed text-neutral-500">
                  <strong className="text-neutral-400">{stage?.romPart}</strong> — {stage?.why}
                </p>
                <div className="space-y-3">
                  {cat.categories
                    .filter((c) => c.toolchains.length > 0)
                    .map((c) => {
                      const blocked = !allowed.has(c.id);
                      return (
                        <div key={c.id}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={`text-[11px] font-medium uppercase tracking-wide ${blocked ? 'text-neutral-600' : 'text-neutral-400'}`}>
                              {c.label}
                            </span>
                            <span className="text-[10px] text-neutral-600">{c.language}</span>
                            {blocked && (
                              <span className="text-[10px] text-rose-500/80">
                                not allowed for this stage
                              </span>
                            )}
                          </div>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {c.toolchains.map((t) => {
                              const active = chosen?.id === t.id;
                              return (
                                <button
                                  type="button"
                                  key={t.id}
                                  disabled={blocked}
                                  onClick={() => pick(role, t.id)}
                                  title={t.note}
                                  className={`rounded border px-2 py-1.5 text-left text-xs transition ${
                                    blocked
                                      ? 'cursor-not-allowed border-neutral-800/60 bg-neutral-900/40 text-neutral-600'
                                      : active
                                        ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200'
                                        : selectedIds.has(t.id)
                                          ? 'border-neutral-700 bg-neutral-800/60 text-neutral-300'
                                          : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600'
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5">
                                    {active && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                                    <span className="truncate font-medium">{t.name}</span>
                                  </div>
                                  <div className="truncate text-[10px] text-neutral-500">
                                    {t.repo}
                                    {t.branch ? ` · ${t.branch}` : ''}
                                    {t.obfuscator ? ' · obfuscator' : ''}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/60">
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-800/40"
        >
          {showTools ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
          <Wrench className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-medium text-neutral-100">Addon tools</span>
          <span className="ml-auto text-xs text-neutral-500">
            {tools.length ? `${tools.length} selected` : `${cat.tools.length} available`}
          </span>
        </button>
        {showTools && (
          <div className="max-h-80 space-y-3 overflow-y-auto border-t border-neutral-800 p-3">
            <p className="text-xs text-neutral-500">
              Fetched into <code className="rounded bg-neutral-800 px-1">addons/</code> at the start of the build, so the
              workflow uses your tools rather than whatever apt ships.
            </p>
            {Object.entries(cat.toolsByKind).map(([kind, list]: [string, ToolDef[]]) => (
              <div key={kind}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                  {KIND_LABEL[kind] ?? kind}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {list.map((t) => {
                    const on = tools.includes(t.id);
                    return (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => onTools(on ? tools.filter((x) => x !== t.id) : [...tools, t.id])}
                        title={`${t.use}\n\nIn the builder: ${t.builder_use}`}
                        className={`rounded border px-2 py-1.5 text-left text-xs transition ${
                          on
                            ? 'border-sky-600 bg-sky-950/50 text-sky-200'
                            : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {on && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                          <span className="truncate font-medium">{t.name}</span>
                        </div>
                        <div className="truncate text-[10px] text-neutral-500">{t.use}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
