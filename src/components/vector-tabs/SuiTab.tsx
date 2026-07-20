import React from 'react';
import { ModuleVectorConfig } from '../../types';

export default function SuiTab({ config, update }: { config: ModuleVectorConfig['sui'], update: (u: any) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-white">
        <input type="checkbox" checked={config.injectCoreHooks} onChange={(e) => update({ injectCoreHooks: e.target.checked })} />
        Inject Sui Core System Hooks
      </label>
      <label className="flex items-center gap-2 text-xs text-white">
        <input type="checkbox" checked={config.hideManager} onChange={(e) => update({ hideManager: e.target.checked })} />
        Hide Root Manager Package Presence
      </label>
    </div>
  );
}
