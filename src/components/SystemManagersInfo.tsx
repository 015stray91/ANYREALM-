import React from 'react';
import { Activity, Package, Server, Code } from 'lucide-react';

export default function SystemManagersInfo() {
  const managers = [
    {
      name: 'ActivityManager (AM)',
      description: 'Manages the lifecycle of activities, services, and tasks.',
      api: 'ActivityManager.startActivity(intent)',
      icon: <Activity className="text-blue-400 w-5 h-5" />
    },
    {
      name: 'PackageManager (PM)',
      description: 'Handles installation, uninstallation, and permission management of APKs.',
      api: 'PackageManager.getPackageInfo(packageName, flags)',
      icon: <Package className="text-emerald-400 w-5 h-5" />
    },
    {
      name: 'ServiceManager (SCM)',
      description: 'Acts as the central registry for system services.',
      api: 'ServiceManager.getService("service_name")',
      icon: <Server className="text-indigo-400 w-5 h-5" />
    }
  ];

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Code className="text-purple-400 w-5 h-5" /> System Manager API Registry
      </h3>
      <div className="space-y-4">
        {managers.map((m, i) => (
          <div key={i} className="p-3 bg-slate-950 rounded-lg border border-slate-900">
            <div className="flex items-center gap-2 mb-2">
              {m.icon}
              <h4 className="text-sm font-semibold text-white">{m.name}</h4>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">{m.description}</p>
            <code className="text-[10px] text-purple-300 bg-purple-950/30 px-2 py-1 rounded block font-mono">
              {m.api}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
