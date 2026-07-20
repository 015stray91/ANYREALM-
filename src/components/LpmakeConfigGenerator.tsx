import React, { useMemo } from 'react';
import { Settings, FileText } from 'lucide-react';
import { DeviceMetadata } from '../types';

interface LpmakeConfigGeneratorProps {
  deviceMetadata: DeviceMetadata | null;
}

export default function LpmakeConfigGenerator({ deviceMetadata }: LpmakeConfigGeneratorProps) {
  const lpmakeConfig = useMemo(() => {
    if (!deviceMetadata) return null;

    // Simplified derivation based on device metadata
    const slotSuffix = deviceMetadata.activeSlot === 'A' ? '_a' : '_b';
    return [
      `BOARD_SUPER_PARTITION_SIZE := 8589934592`,
      `BOARD_SUPER_PARTITION_PARTITION_LIST := system${slotSuffix} vendor${slotSuffix} product${slotSuffix}`,
      `BOARD_SUPER_PARTITION_METADATA_DEVICE := super`,
      `BOARD_SUPER_PARTITION_APPEND_SYSTEM_PARTITIONS := system${slotSuffix}`,
      `AB_OTA_UPDATER := true`,
      `AB_OTA_PARTITIONS := system${slotSuffix} vendor${slotSuffix} boot${slotSuffix}`
    ];
  }, [deviceMetadata]);

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mt-5">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Settings className="text-emerald-400 w-5 h-5" /> lpmake Config Generator
      </h3>
      
      <div className="bg-slate-950 p-4 rounded-lg border border-slate-900 font-mono text-[10px] text-emerald-400 overflow-x-auto">
        {lpmakeConfig ? (
          <>
            <div className="text-slate-500 mb-2">// Generated build variables for {deviceMetadata?.model} (Slot {deviceMetadata?.activeSlot})</div>
            {lpmakeConfig.map((line, i) => <div key={i}>{line}</div>)}
          </>
        ) : (
          <div className="text-slate-600 italic">// Awaiting device discovery...</div>
        )}
      </div>
    </div>
  );
}
