import React from 'react';
import { FolderTree, Shield, Radio, Server } from 'lucide-react';
import { FirmwareBlob, PartitionMap } from '../types';

interface FirmwareInfrastructureAnalyzerProps {
  blobs: FirmwareBlob[];
  partitions: PartitionMap[];
}

export default function FirmwareInfrastructureAnalyzer({ blobs, partitions }: FirmwareInfrastructureAnalyzerProps) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
        <FolderTree className="w-4.5 h-4.5 text-blue-500" /> Discovered Base Low-Level Infrastructure
      </h3>

      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
            <Server className="w-3.5 h-3.5" /> Bootloader Layers
          </h4>
          <div className="bg-slate-950 rounded-lg border border-slate-900 p-2 text-[10px] font-mono text-slate-300">
            {blobs.filter(b => b.type === 'Bootloader').map(b => (
              <div key={b.name} className="flex justify-between"><span>{b.name}</span><span>{(b.sizeBytes/1024).toFixed(2)} KB</span></div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" /> Security & Telemetry Engines
          </h4>
          <div className="bg-slate-950 rounded-lg border border-slate-900 p-2 text-[10px] font-mono text-slate-300">
            {blobs.filter(b => b.type === 'Security').map(b => (
              <div key={b.name} className="flex justify-between"><span>{b.name}</span><span>{(b.sizeBytes/1024).toFixed(2)} KB</span></div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5" /> Cellular Radio
          </h4>
           <div className="bg-slate-950 rounded-lg border border-slate-900 p-2 text-[10px] font-mono text-slate-300">
            {blobs.filter(b => b.type === 'Radio').map(b => (
              <div key={b.name} className="flex justify-between"><span>{b.name}</span><span>{(b.sizeBytes/1024).toFixed(2)} KB</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
