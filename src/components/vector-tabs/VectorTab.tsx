import React from 'react';
import { ModuleVectorConfig } from '../../types';

export default function VectorTab({ config, update, addLog }: { config: ModuleVectorConfig['vector'], update: (u: any) => void, addLog: (m: string) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-white">
        <input type="checkbox" checked={config.injectZygisk} onChange={(e) => { 
          update({ injectZygisk: e.target.checked });
          addLog(`[BLUEPRINT]: Zygisk Injection set to ${e.target.checked}`);
        }} />
        Inject Vector Core Zygisk Engine Layer
      </label>
      <label className="flex items-center gap-2 text-xs text-white">
        <input type="checkbox" checked={config.preloadVictor} onChange={(e) => {
          update({ preloadVictor: e.target.checked });
          addLog(`[BLUEPRINT]: Victor Pre-load set to ${e.target.checked}`);
        }} />
        Pre-load Victor System Manager App
      </label>
    </div>
  );
}
