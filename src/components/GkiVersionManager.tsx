import React from 'react';
import { Layers3, GitBranch, Zap, RefreshCw } from 'lucide-react';

interface GkiVersionManagerProps {
  gkiVersion: 'legacy' | 'gki2.0';
  setGkiVersion: (version: 'legacy' | 'gki2.0') => void;
}

export default function GkiVersionManager({ gkiVersion, setGkiVersion }: GkiVersionManagerProps) {
  const config = {
    legacy: {
      flags: ['BOARD_KERNEL_CMDLINE += androidboot.selinux=permissive'],
      source: 'kernel/msm-4.14',
      headers: 'kernel/msm-4.14/include'
    },
    'gki2.0': {
      flags: ['BOARD_GKI_USE_VNDK := true', 'GKI_MODULAR_KERNEL := true'],
      source: 'common/kernel/generic/5.10',
      headers: 'common/include'
    }
  };

  const active = config[gkiVersion];

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Layers3 className="text-indigo-400 w-5 h-5" /> GKI Version Management
      </h3>
      
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setGkiVersion('legacy')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
            gkiVersion === 'legacy' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <GitBranch className="w-4 h-4" /> Legacy (10-12)
        </button>
        <button
          onClick={() => setGkiVersion('gki2.0')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
            gkiVersion === 'gki2.0' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Zap className="w-4 h-4" /> GKI 2.0 (13+)
        </button>
      </div>

      <div className="p-3 bg-slate-950 rounded-lg border border-slate-900">
        <h4 className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
            <RefreshCw className="text-slate-500 w-4 h-4" /> Active Configuration
        </h4>
        <div className="text-[10px] text-slate-400 space-y-1">
            <p><strong className="text-slate-300">Source:</strong> {active.source}</p>
            <p><strong className="text-slate-300">Headers:</strong> {active.headers}</p>
            <div>
                <strong className="text-slate-300">Flags:</strong>
                <ul className="list-disc list-inside mt-1">
                    {active.flags.map((f, i) => <li key={i} className="font-mono">{f}</li>)}
                </ul>
            </div>
        </div>
      </div>
    </div>
  );
}
