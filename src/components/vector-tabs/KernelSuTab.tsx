import React from 'react';
import { ModuleVectorConfig } from '../../types';

export default function KernelSuTab({ config, update }: { config: ModuleVectorConfig['kernelsu'], update: (u: any) => void }) {
  return (
    <div className="space-y-3">
      <select value={config.variant} onChange={(e) => update({ variant: e.target.value })} className="bg-slate-950 text-white text-xs p-2 rounded w-full border border-slate-900">
        <option value="official">Official KernelSU</option>
        <option value="next">KernelSU-Next</option>
        <option value="gki">KernelSU-GKI</option>
        <option value="ultra">KernelSU-Ultra</option>
      </select>
    </div>
  );
}
