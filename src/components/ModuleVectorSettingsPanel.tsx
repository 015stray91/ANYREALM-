import React, { useState } from 'react';
import { Settings, Brain, Shield, Terminal, Zap } from 'lucide-react';
import { ModuleVectorConfig, DeviceMetadata } from '../types';
import VectorTab from './vector-tabs/VectorTab';
import KernelSuTab from './vector-tabs/KernelSuTab';
import ShizukuTab from './vector-tabs/ShizukuTab';
import SuiTab from './vector-tabs/SuiTab';
import AvbTab from './vector-tabs/AvbTab';
import BlueprintLogger from './BlueprintLogger';

export default function ModuleVectorSettingsPanel({ deviceMetadata }: { deviceMetadata: DeviceMetadata | null }) {
  const [config, setConfig] = useState<ModuleVectorConfig>({
    vector: { injectZygisk: false, preloadVictor: false, scopeIds: [] },
    kernelsu: { variant: 'official', namespaceRules: '' },
    shizuku: { preCompileEngine: false, elevateRish: false },
    sui: { injectCoreHooks: false, hideManager: false },
    avb: { algorithm: 'SHA256_RSA2048', partitionSize: 0, keyFilename: null }
  });

  const [activeTab, setActiveTab] = useState<'vector' | 'kernelsu' | 'shizuku' | 'sui' | 'avb'>('vector');
  const [logs, setLogs] = useState<string[]>(['[MODULE VECTOR MATRIX]: Initialized.']);
  const [isAvbKeyValid, setIsAvbKeyValid] = useState(false);

  const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}]: ${msg}`]);

  const updateConfig = (section: keyof ModuleVectorConfig, updates: any) => {
    setConfig(prev => ({ ...prev, [section]: { ...prev[section], ...updates } }));
    addLog(`[CONFIG UPDATE]: Updated ${section}.`);
  };

  return (
    <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
        <Settings className="text-blue-400 w-6 h-6" /> Module Vector Settings Panel
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-lg p-4">
          <div className="flex gap-2 mb-4 border-b border-[#1e293b] pb-2">
            {[ { id: 'vector', icon: Brain, label: 'Vector' }, { id: 'kernelsu', icon: Shield, label: 'KernelSU' }, { id: 'shizuku', icon: Terminal, label: 'Shizuku' }, { id: 'sui', icon: Zap, label: 'Sui' }, { id: 'avb', icon: Shield, label: 'AVB' } ].map(tab => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id as any); addLog(`[UI MATRIX]: Switched to ${tab.label} Tab.`); }} className={`flex items-center gap-2 px-3 py-1 rounded text-xs ${activeTab === tab.id ? 'bg-blue-900 text-white' : 'text-slate-400'}`}>
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
          {activeTab === 'vector' && <VectorTab config={config.vector} update={(u) => updateConfig('vector', u)} addLog={addLog} />}
          {activeTab === 'kernelsu' && <KernelSuTab config={config.kernelsu} update={(u) => updateConfig('kernelsu', u)} />}
          {activeTab === 'shizuku' && <ShizukuTab config={config.shizuku} update={(u) => updateConfig('shizuku', u)} />}
          {activeTab === 'sui' && <SuiTab config={config.sui} update={(u) => updateConfig('sui', u)} />}
          {activeTab === 'avb' && <AvbTab config={config.avb} update={(u) => updateConfig('avb', u)} deviceMetadata={deviceMetadata} addLog={addLog} onKeyValidated={setIsAvbKeyValid} />}
        </div>
        <BlueprintLogger logs={logs} />
      </div>
    </div>
  );
}
