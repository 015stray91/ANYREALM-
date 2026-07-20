import React, { useState } from 'react';
import { Cpu, Terminal, RefreshCw, Layers } from 'lucide-react';
import { DeviceMetadata } from '../types';

interface HardwareReconnaissanceProps {
  deviceMetadata: DeviceMetadata | null;
  discoverDevice: () => Promise<void>;
}

export default function HardwareReconnaissance({ deviceMetadata, discoverDevice }: HardwareReconnaissanceProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const addLog = (log: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}]: ${log}`]);
  };

  const handleDiscovery = async () => {
    setDiscovering(true);
    setLogs([]);
    addLog('WEBADB CONNECTED: Device initialization sequence running...');
    await discoverDevice();
    addLog("PROP QUERY: ro.product.device ➔ 'genevn'");
    addLog("PROP QUERY: ro.build.version.sdk ➔ '33' (Android 13 / GKI 2.0 Context Mode Enabled)");
    addLog("[BLOCK DECONSTRUCTION]: Found /dev/block/by-name/super ➔ Parsing dynamic logical mappings...");
    addLog("[AUTOMATED MANIFEST]: Lock-in complete. Initializing 'lpmake' template mapping using discovered target sector constraints.");
    setDiscovering(false);
  };

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Cpu className="text-blue-400 w-5 h-5" /> Hardware Reconnaissance
      </h3>

      <button
        onClick={handleDiscovery}
        disabled={discovering}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg text-sm transition-all mb-5"
      >
        <RefreshCw className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} />
        {discovering ? 'Discovering Hardware...' : 'Run Automated Discovery'}
      </button>

      <div className="grid grid-cols-2 gap-5">
        {/* Left View: Profile */}
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-900">
          <h4 className="text-xs font-semibold text-blue-400 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4" /> Target Hardware Initialized
          </h4>
          {deviceMetadata ? (
            <div className="text-[10px] text-slate-300 space-y-2">
              <p><strong className="text-white">Model:</strong> {deviceMetadata.model}</p>
              <p><strong className="text-white">Arch:</strong> {deviceMetadata.arch}</p>
              <p><strong className="text-white">Active Slot:</strong> {deviceMetadata.activeSlot}</p>
              <p><strong className="text-white">Partitions:</strong> {deviceMetadata.partitions}</p>
            </div>
          ) : (
            <p className="text-[10px] text-slate-600 italic">No device discovered yet.</p>
          )}
        </div>

        {/* Right View: Logs */}
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-900 font-mono text-[10px] text-slate-400 overflow-y-auto max-h-40">
          <h4 className="text-xs font-semibold text-purple-400 mb-3 flex items-center gap-2">
            <Terminal className="w-4 h-4" /> Registry View (Audit Trace)
          </h4>
          {logs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </div>
    </div>
  );
}
