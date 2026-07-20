import React, { useState } from 'react';
import { Shield, Zap, Terminal } from 'lucide-react';

interface VerificationCockpitProps {
  deviceMetadata: any; // Placeholder for now
}

export default function VerificationCockpit({ deviceMetadata }: VerificationCockpitProps) {
  const [logs, setLogs] = useState<string[]>(['[AOSP INITIALIZER]: Preparing Green State boot packaging environment...']);
  const [compilerFlags] = useState('LLVM=-12');
  const [bootHeader, setBootHeader] = useState<'v3' | 'v4'>('v4');

  const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}]: ${msg}`]);

  const runVerification = (action: string) => {
    addLog(`[ACTION]: Executing ${action}...`);
    if (action === 'unpack') {
      addLog('$ unpackbootimg -i boot.img -o ./extracted_boot/');
    } else if (action === 'avb') {
      addLog(`[AVB MATRIX]: Generating custom cryptographic hash footer matching target partition sector bounds...`);
      addLog(`$ avbtool add_hash_footer --image boot.new.img --partition_size 67108864 --partition_name boot --algorithm SHA256_RSA2048 --key custom_key.pem`);
    }
  };

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5 grid grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Shield className="text-emerald-400 w-5 h-5" /> Verification Cockpit
        </h3>
        <div className="flex gap-2">
          <button onClick={() => setBootHeader('v3')} className={`px-3 py-1 text-xs rounded ${bootHeader === 'v3' ? 'bg-blue-600' : 'bg-slate-800'}`}>Boot Header V3</button>
          <button onClick={() => setBootHeader('v4')} className={`px-3 py-1 text-xs rounded ${bootHeader === 'v4' ? 'bg-blue-600' : 'bg-slate-800'}`}>Boot Header V4</button>
        </div>
        <input type="text" value={compilerFlags} readOnly className="w-full bg-slate-950 p-2 text-xs font-mono rounded border border-slate-900" />
        <div className="flex gap-2">
          <button onClick={() => runVerification('unpack')} className="bg-slate-800 text-xs p-2 rounded">Execute C++ unpackbootimg</button>
          <button onClick={() => runVerification('avb')} className="bg-emerald-600 text-xs p-2 rounded">Add Green State AVB Hash Footer</button>
        </div>
      </div>
      <div className="bg-slate-950 p-4 rounded-lg border border-slate-900 font-mono text-[10px] text-slate-400 overflow-y-auto max-h-60">
        <h4 className="text-xs font-semibold text-purple-400 mb-3 flex items-center gap-2"><Terminal className="w-4 h-4" /> AOSP Protocol Terminal</h4>
        {logs.map((log, i) => <div key={i}>{log}</div>)}
      </div>
    </div>
  );
}
