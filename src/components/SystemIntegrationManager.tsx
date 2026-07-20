import React from 'react';
import { Settings, GitBranch, Cpu } from 'lucide-react';

export default function SystemIntegrationManager() {
  const integrations = [
    { name: 'KernelSU', type: 'KPM (Kernel Module)', status: 'System-Integrated' },
    { name: 'Shizuku', type: 'Binder Proxy', status: 'System-Integrated' },
    { name: 'LKM Manager', type: 'LKM (Kernel Module)', status: 'Active' },
    { name: 'NetHunter', type: 'Framework/Toolset', status: 'System-Integrated' }
  ];

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Settings className="text-emerald-400 w-5 h-5" /> System-Integrated Functions
      </h3>
      <div className="space-y-3">
        {integrations.map((int, i) => (
          <div key={i} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-900">
            <div className="flex items-center gap-3">
              <Cpu className="text-slate-500 w-4 h-4" />
              <div>
                <p className="text-sm font-semibold text-white">{int.name}</p>
                <p className="text-[10px] text-slate-400">{int.type}</p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 px-2 py-1 rounded">
              {int.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
