import React from 'react';
import { ModuleVectorConfig } from '../../types';

export default function ShizukuTab({ config, update }: { config: ModuleVectorConfig['shizuku'], update: (u: any) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-white">
        <input type="checkbox" checked={config.preCompileEngine} onChange={(e) => update({ preCompileEngine: e.target.checked })} />
        Pre-compile Shizuku Shell Engine
      </label>
      <label className="flex items-center gap-2 text-xs text-white">
        <input type="checkbox" checked={config.elevateRish} onChange={(e) => update({ elevateRish: e.target.checked })} />
        Elevate rish Terminal Permissions
      </label>
    </div>
  );
}
