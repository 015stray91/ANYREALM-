import React from 'react';

export default function BlueprintLogger({ logs }: { logs: string[] }) {
  return (
    <div className="bg-slate-950 p-4 rounded-lg border border-slate-900 font-mono text-[10px] text-slate-400 overflow-y-auto max-h-60">
      <h4 className="text-xs font-semibold text-purple-400 mb-3">Registry View (Audit Trace)</h4>
      {logs.map((log, i) => <div key={i}>{log}</div>)}
    </div>
  );
}
