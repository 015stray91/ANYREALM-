import React from 'react';
import { Cpu, Box, Terminal } from 'lucide-react';

export default function LorryModuleApiManager() {
  const modules = [
    {
      name: 'LKM (Loadable Kernel Module)',
      description: 'Extends kernel functionality dynamically at runtime.',
      api: 'insmod /path/to/module.ko',
      icon: <Box className="text-orange-400 w-5 h-5" />
    },
    {
      name: 'KPM (Kernel Patch Module)',
      description: 'Hooks into kernel functions to patch behavior in-memory.',
      api: 'kpm_hook_symbol("sys_call_table", address)',
      icon: <Cpu className="text-red-400 w-5 h-5" />
    }
  ];

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Terminal className="text-orange-400 w-5 h-5" /> Lorry Module API Manager
      </h3>
      <div className="space-y-4">
        {modules.map((m, i) => (
          <div key={i} className="p-3 bg-slate-950 rounded-lg border border-slate-900">
            <div className="flex items-center gap-2 mb-2">
              {m.icon}
              <h4 className="text-sm font-semibold text-white">{m.name}</h4>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">{m.description}</p>
            <code className="text-[10px] text-orange-300 bg-orange-950/30 px-2 py-1 rounded block font-mono">
              {m.api}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
