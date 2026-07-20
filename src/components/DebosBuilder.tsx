import React, { useState } from 'react';
import { Terminal, HardDrive } from 'lucide-react';

export default function DebosBuilder() {
  const [building, setBuilding] = useState(false);

  const build = () => {
    setBuilding(true);
    // Simulate debos build
    setTimeout(() => setBuilding(false), 3000);
  };

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <HardDrive className="text-indigo-500 w-5 h-5" /> DEbOS Image Builder
      </h3>
      <button
        onClick={build}
        disabled={building}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg text-sm transition-all"
      >
        {building ? 'Building...' : 'Build Debian Image (debos)'}
      </button>
    </div>
  );
}
