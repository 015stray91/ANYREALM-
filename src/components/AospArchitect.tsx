/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import BlueprintVisualizer from './BlueprintVisualizer';
import BootSequenceAnalyzer from './BootSequenceAnalyzer';
import DebosBuilder from './DebosBuilder';
import GkiVersionManager from './GkiVersionManager';
import SystemIntegrationManager from './SystemIntegrationManager';
import SystemManagersInfo from './SystemManagersInfo';
import LorryModuleApiManager from './LorryModuleApiManager';
import FirmwareInfrastructureAnalyzer from './FirmwareInfrastructureAnalyzer';
import NetHunterSystemIntegrator from './NetHunterSystemIntegrator';
import HardwareReconnaissance from './HardwareReconnaissance';
import LpmakeConfigGenerator from './LpmakeConfigGenerator';
import VerificationCockpit from './VerificationCockpit';
import RetailCarrierMitigationEngine from './RetailCarrierMitigationEngine';
import { 
  Cpu, 
  Layers, 
  Terminal, 
  GitCommit, 
  Plus, 
  Trash2, 
  Play, 
  ArrowRight, 
  Shuffle, 
  FileCode, 
  Settings, 
  Check, 
  User, 
  Wrench, 
  Zap, 
  Layers3,
  HelpCircle,
  FolderTree,
  Network,
  History
} from 'lucide-react';
import * as yaml from 'js-yaml';
import { DeviceMetadata, AospLayer, AospComponent, AospLayerType, AidlMethod, GeneratedFile, FirmwareBlob, PartitionMap } from '../types';

interface AospArchitectProps {
  onSelectComponent: (component: AospComponent) => void;
  selectedComponent: AospComponent | null;
  components: AospComponent[];
  setComponents: React.Dispatch<React.SetStateAction<AospComponent[]>>;
  generatedFiles: GeneratedFile[];
  setGeneratedFiles: React.Dispatch<React.SetStateAction<GeneratedFile[]>>;
  onGenerateCode: (component: AospComponent) => void;
  isGenerating: boolean;
  deviceMetadata: DeviceMetadata | null;
  discoverDevice: () => Promise<void>;
}

export default function AospArchitect({
  onSelectComponent,
  selectedComponent,
  components,
  setComponents,
  generatedFiles,
  setGeneratedFiles,
  onGenerateCode,
  isGenerating,
  deviceMetadata,
  discoverDevice
}: AospArchitectProps) {
  const [activeLayer, setActiveLayer] = useState<AospLayerType>('Framework Services');
  const [visualizerMode, setVisualizerMode] = useState<'node-map' | 'tree-map'>('node-map');
  const [newCompName, setNewCompName] = useState('');
  const [newCompDesc, setNewCompDesc] = useState('');
  const [newCompType, setNewCompType] = useState('System Service');
  const [newCompSelinux, setNewCompSelinux] = useState('system_server_service');
  const [newCompLayer, setNewCompLayer] = useState<AospLayerType>('Framework Services');
  
  const [blobs] = useState<FirmwareBlob[]>([
    { name: 'xbl.mbn', type: 'Bootloader', sizeBytes: 1024 * 512, path: '/firmware/xbl.mbn' },
    { name: 'tz.bin', type: 'Security', sizeBytes: 1024 * 256, path: '/firmware/tz.bin' },
    { name: 'modem.mbn', type: 'Radio', sizeBytes: 1024 * 1024 * 10, path: '/firmware/modem.mbn' },
  ]);
  const [partitions] = useState<PartitionMap[]>([
    { name: 'super', startSector: 0, sizeBytes: 1024 * 1024 * 1024 * 4 },
  ]);
  
  // AIDL builders for new system service
  const [aidlMethods, setAidlMethods] = useState<AidlMethod[]>([
    { name: 'registerCallback', returnType: 'void', parameters: [{ name: 'cb', type: 'IColorCallback', direction: 'in' }] },
    { name: 'getLatestColorData', returnType: 'int[]', parameters: [] }
  ]);
  const [newMethodName, setNewMethodName] = useState('');
  const [newMethodReturn, setNewMethodReturn] = useState('int');
  const [history, setHistory] = useState<{ components: AospComponent[], generatedFiles: GeneratedFile[] }[]>([]);
  const [gkiVersion, setGkiVersion] = useState<'legacy' | 'gki2.0'>('legacy');

  // Simulation controls
  const [simActive, setSimActive] = useState(false);
  const [simStep, setSimStep] = useState<number>(-1);

  const snapshot = () => {
    setHistory(prev => [{ components, generatedFiles }, ...prev].slice(0, 5));
  };

  const restore = (snapshotData: { components: AospComponent[], generatedFiles: GeneratedFile[] }) => {
    setComponents(snapshotData.components);
    setGeneratedFiles(snapshotData.generatedFiles);
  };

  const layers: AospLayer[] = [
    { id: 'Apps', name: 'Application Layer', description: 'System Apps and Settings UI utilizing high-level Android SDK managers.', color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', textColor: 'text-emerald-400' },
    { id: 'Framework Services', name: 'Java System Services', description: 'Bridges apps with hardware. Lives inside system_server, registered with ServiceManager.', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400', textColor: 'text-blue-400' },
    { id: 'Native Daemons', name: 'Native System Services', description: 'C++ low level background services managing core state (e.g. binder, surfaceflinger).', color: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400', textColor: 'text-indigo-400' },
    { id: 'HAL', name: 'Hardware Abstraction (HAL)', description: 'Exposes C++ AIDL/HIDL services, acting as the stable interface to drivers.', color: 'bg-purple-500/10 border-purple-500/30 text-purple-400', textColor: 'text-purple-400' },
    { id: 'Kernel', name: 'Linux Kernel & Drivers', description: 'Low level hardware communications, exposing files like devtmpfs /dev/nodes.', color: 'bg-rose-500/10 border-rose-500/30 text-rose-400', textColor: 'text-rose-400' }
  ];

  const addMethod = () => {
    if (!newMethodName.trim()) return;
    setAidlMethods(prev => [...prev, {
      name: newMethodName.trim(),
      returnType: newMethodReturn,
      parameters: []
    }]);
    setNewMethodName('');
  };

  const removeMethod = (index: number) => {
    setAidlMethods(prev => prev.filter((_, i) => i !== index));
  };

  const addNewComponent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompName.trim()) return;

    const formattedId = newCompName.toLowerCase().replace(/\s+/g, '_');
    const newComponent: AospComponent = {
      id: formattedId,
      name: newCompName.trim(),
      layer: newCompLayer,
      type: newCompType,
      description: newCompDesc || `Custom system component managing ${newCompName} operations inside the OS core.`,
      selinuxContext: newCompSelinux || `${formattedId}_service`,
      dependencies: newCompLayer === 'Framework Services' ? ['custom_sensor_hal'] : [],
      aidlMethods: newCompLayer === 'Framework Services' || newCompLayer === 'HAL' ? aidlMethods : undefined,
      isCustom: true
    };

    setComponents(prev => [...prev, newComponent]);
    onSelectComponent(newComponent);
    
    // Reset form
    setNewCompName('');
    setNewCompDesc('');
    setAidlMethods([
      { name: 'registerCallback', returnType: 'void', parameters: [{ name: 'cb', type: 'IColorCallback', direction: 'in' }] }
    ]);
  };

  const deleteComponent = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setComponents(prev => prev.filter(c => c.id !== id));
    if (selectedComponent?.id === id) {
      onSelectComponent(components[0] || null);
    }
  };

  // Hardware event pipeline simulator
  const simSteps = [
    {
      layer: 'Kernel',
      comp: 'sensor_driver',
      title: '1. Hardware Interrupt & Register Write',
      desc: 'Physical color sensor alerts Linux driver. Kernel driver handles I2C read and pushes values to devnode file /dev/colorsensor.',
      code: 'i2c_smbus_read_i2c_block_data(client, REG_COLOR, 6, buf);'
    },
    {
      layer: 'Native Daemons',
      comp: 'sensor_daemon',
      title: '2. Native Daemon Event Loop',
      desc: 'A C++ poll() loop wakes up on /dev/colorsensor state changes. It structures raw values into RGB structs.',
      code: 'int fd = open("/dev/colorsensor", O_RDONLY); read(fd, raw_bytes, 6);'
    },
    {
      layer: 'HAL',
      comp: 'custom_sensor_hal',
      title: '3. AIDL HAL Service Call',
      desc: 'The sensor HAL exposes standard binder IPC. The daemon communicates coordinates into HAL binder interfaces.',
      code: 'ndk::ScopedAStatus status = mCallback->onColorDetected(data);'
    },
    {
      layer: 'Framework Services',
      comp: 'custom_sensor_service',
      title: '4. System Service JNI Dispatcher',
      desc: 'Lives inside system_server. Receives HAL binder callback, translates native struct to Java fields and dispatches OS broadcast.',
      code: 'private final IColorSensor.Stub mBinder = new IColorSensor.Stub() { ... };'
    },
    {
      layer: 'Apps',
      comp: 'color_picker_app',
      title: '5. Application UI Renders Framework Event',
      desc: 'System app handles custom broadcast or binds to the system service. Receives precise colors in real time and updates view canvas.',
      code: 'ColorManager manager = (ColorManager) getSystemService(Context.COLOR_SENSOR_SERVICE);'
    }
  ];

  const triggerSimulation = () => {
    if (simActive) return;
    setSimActive(true);
    setSimStep(0);

    const runStep = (step: number) => {
      if (step < simSteps.length) {
        setSimStep(step);
        // Find corresponding component to highlight it in UI
        const comp = components.find(c => c.id === simSteps[step].comp);
        if (comp) {
          onSelectComponent(comp);
        }
        setTimeout(() => runStep(step + 1), 3000);
      } else {
        setSimActive(false);
        setSimStep(-1);
      }
    };

    runStep(0);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="architect-studio-workspace">
      {/* OS Layers Panel & Simulator */}
      <div className="lg:col-span-8 flex flex-col gap-6">
        
        {/* Layer Filters */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Layers3 className="w-4.5 h-4.5 text-blue-500" /> Interactive OS Layer Stack
          </h3>
          
          <div className="flex flex-col gap-2">
            {layers.map((l) => (
              <button
                key={l.id}
                onClick={() => setActiveLayer(l.id)}
                className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  activeLayer === l.id 
                    ? 'bg-blue-500/10 border-blue-500/60 shadow-lg shadow-blue-500/5' 
                    : 'bg-[#0b0f19] border-[#1e293b] hover:border-slate-800'
                }`}
                id={`layer-tab-${l.id}`}
              >
                <div className="max-w-md">
                  <span className={`text-xs font-bold font-mono tracking-wide uppercase px-2 py-0.5 rounded ${
                    activeLayer === l.id ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-900 text-slate-400'
                  }`}>
                    {l.id} Layer
                  </span>
                  <h4 className="text-base font-bold text-white mt-1.5">{l.name}</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{l.description}</p>
                </div>
                
                <div className="mt-3 md:mt-0 flex items-center gap-2 text-xs text-slate-500">
                  <span>
                    {components.filter(c => c.layer === l.id).length} components
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 hidden md:block" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Node Diagram & Component Map inside current layer */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="text-blue-500 w-5 h-5" /> Workspace Blueprint
              </h3>
              <p className="text-xs text-slate-400">
                {visualizerMode === 'node-map' 
                  ? `Layer Node Map: ${activeLayer}` 
                  : 'Interactive Architecture Tree Map'}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-900">
                <button
                  type="button"
                  onClick={() => setVisualizerMode('node-map')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-all cursor-pointer ${
                    visualizerMode === 'node-map'
                      ? 'bg-blue-600 text-white shadow font-bold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Node Map
                </button>
                <button
                  type="button"
                  onClick={() => setVisualizerMode('tree-map')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-all cursor-pointer ${
                    visualizerMode === 'tree-map'
                      ? 'bg-blue-600 text-white shadow font-bold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Tree Map
                </button>
              </div>

              <button
                onClick={triggerSimulation}
                disabled={simActive || visualizerMode === 'tree-map'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg hover:bg-emerald-500/20 disabled:opacity-50 transition-all cursor-pointer"
                id="start-hardware-simulation"
              >
                <Play className="w-3.5 h-3.5 fill-emerald-400" />
                {simActive ? "Simulating..." : "Simulate Call"}
              </button>
            </div>
          </div>

          {visualizerMode === 'tree-map' ? (
            <BlueprintVisualizer components={components} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-h-[180px]">
              {components.filter(c => c.layer === activeLayer).map((comp) => (
                <div
                  key={comp.id}
                  onClick={() => onSelectComponent(comp)}
                  className={`relative group p-4 rounded-xl border text-left cursor-pointer transition-all ${
                    selectedComponent?.id === comp.id
                      ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-blue-500 shadow-md shadow-blue-500/10'
                      : 'bg-slate-950/60 border-[#1e293b] hover:border-slate-800'
                  }`}
                  id={`component-node-${comp.id}`}
                >
                  {comp.isCustom && (
                    <span className="absolute top-3 right-3 text-[10px] font-bold font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">
                      User Made
                    </span>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 group-hover:bg-slate-800 transition-colors">
                      <FileCode className="w-4 h-4 text-blue-400" />
                    </span>
                    <div>
                      <h4 className="font-bold text-white text-sm font-mono">{comp.name}</h4>
                      <span className="text-[11px] font-mono text-slate-400 block mt-0.5">{comp.type}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 mt-2.5 leading-relaxed line-clamp-2">{comp.description}</p>
                  
                  {comp.aidlMethods && comp.aidlMethods.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-900/40">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">AIDL Methods</span>
                      <div className="flex flex-wrap gap-1">
                        {comp.aidlMethods.map((m, idx) => (
                          <span key={idx} className="text-[10px] font-mono bg-slate-900/80 text-slate-300 px-1.5 py-0.5 rounded border border-slate-800">
                            {m.name}()
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-[11px] font-mono border-t border-slate-900/40 pt-2 text-slate-500">
                    <span className="truncate max-w-[150px]">SELinux: {comp.selinuxContext}</span>
                    {comp.isCustom && (
                      <button
                        onClick={(e) => deleteComponent(comp.id, e)}
                        className="text-rose-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 cursor-pointer transition-colors"
                        title="Delete Component"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Firmware Infrastructure Analyzer */}
        <FirmwareInfrastructureAnalyzer blobs={blobs} partitions={partitions} />

        {/* Live Simulation Visual Log */}
        {simActive && (
          <div className="bg-[#111827] border border-emerald-500/40 rounded-xl p-5 shadow-lg shadow-emerald-500/5 animate-fade-in">
            <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Zap className="w-4.5 h-4.5 text-emerald-400" /> Active Hardware-to-App Call Stack Trace
            </h3>

            <div className="space-y-4">
              {simSteps.map((step, idx) => (
                <div 
                  key={idx} 
                  className={`flex gap-4 p-4 rounded-xl border transition-all ${
                    simStep === idx 
                      ? 'bg-emerald-500/10 border-emerald-500/60 shadow-md shadow-emerald-500/5 translate-x-1' 
                      : 'bg-slate-950/30 border-slate-900 opacity-40'
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold font-mono text-xs ${
                      simStep === idx ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {idx + 1}
                    </div>
                    {idx < simSteps.length - 1 && (
                      <div className="w-0.5 h-12 bg-slate-800 mt-2" />
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold font-mono bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        {step.layer} Layer
                      </span>
                      <span className="text-xs font-semibold text-slate-400 font-mono">@{step.comp}</span>
                    </div>
                    <h4 className="font-bold text-white text-sm mt-1.5">{step.title}</h4>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">{step.desc}</p>
                    
                    {simStep === idx && (
                      <div className="mt-3 p-2 bg-slate-950 border border-emerald-500/20 rounded font-mono text-[10px] text-emerald-400">
                        <code>{step.code}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Component Bootstrapper / Blueprint Creator Panel */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-base font-bold text-white flex items-center gap-2 mb-4">
            <Plus className="text-blue-500 w-5 h-5" /> OS Component Creator
          </h3>

          <form onSubmit={addNewComponent} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Target Layer</label>
              <select
                value={newCompLayer}
                onChange={(e) => {
                  const val = e.target.value as AospLayerType;
                  setNewCompLayer(val);
                  if (val === 'Framework Services') {
                    setNewCompType('System Service');
                    setNewCompSelinux('system_server_service');
                  } else if (val === 'HAL') {
                    setNewCompType('HAL Service (C++)');
                    setNewCompSelinux('hal_colorsensor_default');
                  } else if (val === 'Native Daemons') {
                    setNewCompType('Native Daemon');
                    setNewCompSelinux('sensor_daemon_exec');
                  } else if (val === 'Kernel') {
                    setNewCompType('Driver');
                    setNewCompSelinux('colorsensor_device');
                  } else {
                    setNewCompType('System App');
                    setNewCompSelinux('system_app_service');
                  }
                }}
                className="w-full bg-slate-950/80 border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
              >
                {layers.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Component Name</label>
              <input
                type="text"
                required
                placeholder="e.g. ColorSensor"
                value={newCompName}
                onChange={(e) => setNewCompName(e.target.value)}
                className="w-full bg-slate-950/80 border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">SELinux Context Name</label>
              <input
                type="text"
                placeholder="e.g. system_server_service"
                value={newCompSelinux}
                onChange={(e) => setNewCompSelinux(e.target.value)}
                className="w-full bg-slate-950/80 border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Description / Responsibility</label>
              <textarea
                placeholder="Describe what this module does in AOSP..."
                value={newCompDesc}
                onChange={(e) => setNewCompDesc(e.target.value)}
                className="w-full bg-slate-950/80 border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 min-h-[70px] resize-none"
              />
            </div>

            {/* Custom AIDL Methods Builder */}
            {(newCompLayer === 'Framework Services' || newCompLayer === 'HAL') && (
              <div className="border-t border-slate-900/60 pt-4">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Build AIDL Interfaces</label>
                
                <div className="space-y-2 mb-3">
                  {aidlMethods.map((m, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-slate-950/60 p-2 rounded border border-slate-900 font-mono text-[11px] text-slate-300">
                      <span>{m.returnType} {m.name}()</span>
                      <button 
                        type="button" 
                        onClick={() => removeMethod(idx)}
                        className="text-rose-500 hover:text-rose-400 p-0.5 cursor-pointer"
                      >
                        <Trash2 className="w-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="methodName"
                    value={newMethodName}
                    onChange={(e) => setNewMethodName(e.target.value)}
                    className="flex-1 bg-slate-950/80 border border-[#1e293b] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <select
                    value={newMethodReturn}
                    onChange={(e) => setNewMethodReturn(e.target.value)}
                    className="bg-slate-950/80 border border-[#1e293b] rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none font-mono"
                  >
                    <option value="int">int</option>
                    <option value="void">void</option>
                    <option value="boolean">boolean</option>
                    <option value="String">String</option>
                    <option value="byte[]">byte[]</option>
                  </select>
                  <button
                    type="button"
                    onClick={addMethod}
                    className="px-3 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-blue-400 font-bold rounded-lg text-xs cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold py-2.5 rounded-lg text-sm transition-all shadow-md shadow-blue-500/10 mt-2 cursor-pointer"
              id="submit-new-component"
            >
              <Plus className="w-4 h-4" /> Register Blueprint Component
            </button>
          </form>
        </div>

        <BootSequenceAnalyzer />
        <DebosBuilder />
        <GkiVersionManager gkiVersion={gkiVersion} setGkiVersion={setGkiVersion} />
        <SystemIntegrationManager />
        <SystemManagersInfo />
        <LorryModuleApiManager />
        <NetHunterSystemIntegrator />
        <HardwareReconnaissance deviceMetadata={deviceMetadata} discoverDevice={discoverDevice} />
        <LpmakeConfigGenerator deviceMetadata={deviceMetadata} />
        <VerificationCockpit deviceMetadata={deviceMetadata} />
        <RetailCarrierMitigationEngine addLog={(m) => console.log(m)} />
        
        {/* Selected Component Information Panel */}
        {selectedComponent && (
          <div className="bg-[#111827] border border-blue-500/20 rounded-xl p-5 relative overflow-hidden" id="selected-component-details">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl pointer-events-none" />
            
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 font-mono mb-2">{selectedComponent.layer} Layer</h4>
            <h3 className="text-xl font-bold text-white font-mono flex items-center gap-2">
              {selectedComponent.name}
            </h3>
            
            <div className="mt-3 space-y-3">
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Service Type</span>
                <span className="text-xs font-mono text-slate-300 bg-slate-950/80 px-2 py-1 rounded border border-slate-900 block mt-1">
                  {selectedComponent.type}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">SELinux Security Context</span>
                <span className="text-xs font-mono text-amber-400 bg-slate-950/80 px-2 py-1 rounded border border-slate-900 block mt-1">
                  u:object_r:{selectedComponent.selinuxContext}:s0
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Description</span>
                <p className="text-xs text-slate-300 leading-relaxed mt-1 bg-slate-950/40 p-2.5 rounded border border-slate-900/60">
                  {selectedComponent.description}
                </p>
              </div>

              {selectedComponent.aidlMethods && selectedComponent.aidlMethods.length > 0 && (
                <div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">AIDL Interface Binder Methods</span>
                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                    {selectedComponent.aidlMethods.map((m, idx) => (
                      <div key={idx} className="bg-slate-950 p-2 rounded border border-slate-900 text-[11px] font-mono text-slate-300">
                        <span className="text-indigo-400">{m.returnType}</span> <span className="text-emerald-400">{m.name}</span>
                        <span>(
                          {m.parameters.map((p, i) => (
                            <span key={i} className="text-slate-400">
                              {p.direction} {p.type} {p.name}{i < m.parameters.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        )</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => onGenerateCode(selectedComponent)}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-blue-400 font-semibold py-2.5 rounded-lg text-xs mt-5 transition-all cursor-pointer"
              id="generate-component-code"
            >
              {isGenerating ? <Shuffle className="w-3.5 h-3.5 animate-spin" /> : <FileCode className="w-3.5 h-3.5" />}
              {isGenerating ? "Compiling Framework Code..." : "Compile Platform Code (Java/C++/AIDL)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
