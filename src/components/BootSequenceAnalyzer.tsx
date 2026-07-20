import React, { useState } from 'react';
import { ShieldAlert, Search } from 'lucide-react';

export default function BootSequenceAnalyzer() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const analyze = () => {
    setAnalyzing(true);
    // Simulate analysis
    setTimeout(() => {
      setResult('Boot sequence validated: kernel entry point, ramdisk, and fstab loaded successfully.');
      setAnalyzing(false);
    }, 2000);
  };

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <ShieldAlert className="text-amber-500 w-5 h-5" /> Boot Sequence Analyzer
      </h3>
      <button
        onClick={analyze}
        disabled={analyzing}
        className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 rounded-lg text-sm transition-all"
      >
        {analyzing ? 'Analyzing...' : 'Scan Boot Sequence'}
      </button>
      {result && (
        <div className="mt-4 p-3 bg-slate-950 border border-slate-900 rounded text-xs font-mono text-slate-300">
          {result}
        </div>
      )}
    </div>
  );
}
