import React, { useState } from 'react';
import { Terminal, Shield, Wifi, Server, FileCode } from 'lucide-react';

export default function NetHunterSystemIntegrator() {
  const [tools, setTools] = useState([
    { name: 'Aircrack-ng', status: 'Available', flag: 'PRODUCT_PACKAGES += aircrack-ng' },
    { name: 'Nmap', status: 'Available', flag: 'PRODUCT_PACKAGES += nmap' },
    { name: 'Metasploit', status: 'Available', flag: 'PRODUCT_PACKAGES += metasploit' },
    { name: 'Kismet', status: 'Available', flag: 'PRODUCT_PACKAGES += kismet' }
  ]);

  const toggleIntegration = (name: string) => {
    setTools(prev => prev.map(t => t.name === name ? { ...t, status: t.status === 'Integrated' ? 'Available' : 'Integrated' } : t));
  };

  const activeFlags = tools.filter(t => t.status === 'Integrated').map(t => t.flag);

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Shield className="text-red-400 w-5 h-5" /> NetHunter System Integrator
      </h3>
      <p className="text-xs text-slate-400 mb-4">Select tools to map as core AOSP system binaries.</p>
      
      <div className="space-y-3 mb-6">
        {tools.map((tool) => (
          <div key={tool.name} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-900">
            <div className="flex items-center gap-3">
              {tool.name === 'Nmap' ? <Terminal className="w-4 h-4 text-slate-500"/> : 
               tool.name === 'Kismet' ? <Wifi className="w-4 h-4 text-slate-500"/> : 
               <Server className="w-4 h-4 text-slate-500"/>}
              <span className="text-sm text-white font-medium">{tool.name}</span>
            </div>
            <button
              onClick={() => toggleIntegration(tool.name)}
              className={`text-[10px] font-bold px-2 py-1 rounded transition-all ${
                tool.status === 'Integrated' ? 'bg-red-950 text-red-400' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {tool.status}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-slate-950 p-4 rounded-lg border border-slate-900">
        <h4 className="text-xs font-semibold text-white flex items-center gap-2 mb-2">
            <FileCode className="w-4 h-4 text-slate-400"/> AOSP Build Config
        </h4>
        <div className="text-[10px] font-mono text-slate-400 overflow-x-auto">
            {activeFlags.length > 0 ? (
                activeFlags.map((flag, i) => <div key={i}>{flag}</div>)
            ) : (
                <div className="text-slate-600 italic">// No tools selected</div>
            )}
        </div>
      </div>
    </div>
  );
}
