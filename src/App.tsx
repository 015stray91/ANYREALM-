/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  GitMerge, 
  Layers, 
  Terminal, 
  HelpCircle, 
  Sparkles, 
  Cpu, 
  Play, 
  Plus, 
  Check, 
  AlertTriangle,
  FolderTree,
  Code2,
  Info,
  Database,
  Workflow,
  Languages,
  HardDrive,
  FileArchive,
  Users,
  Wrench
} from 'lucide-react';
import AospArchitect from './components/AospArchitect';
import RootfsFuser from './components/RootfsFuser';
import AospCodeStudio from './components/AospCodeStudio';
import DeveloperConsole from './components/DeveloperConsole';
import SuperPartitionStudio from './components/SuperPartitionStudio';
import AutomationStudio from './components/AutomationStudio';
import UiTranslatorInterpreter from './components/UiTranslatorInterpreter';
import IsoDissectorStudio from './components/IsoDissectorStudio';
import FirmwareDecomposer from './components/FirmwareDecomposer';
import PeoplesImporter from './components/PeoplesImporter';
import AndroidImageKitchen from './components/AndroidImageKitchen';
import { AospComponent, GeneratedFile } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'architect' | 'fuser' | 'code' | 'super' | 'automation' | 'interpreter' | 'iso_fs' | 'firmware' | 'peoples' | 'aik'>('architect');
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isRefactoringCode, setIsRefactoringCode] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  
  // Initial pre-configured core components of our custom AOSP Board
  const [components, setComponents] = useState<AospComponent[]>([
    {
      id: 'color_picker_app',
      name: 'ColorPicker System UI',
      layer: 'Apps',
      type: 'System UI Application',
      description: 'An AOSP pre-installed system application that displays the colors and coordinates detected by the physical sensor. Dynamically links to the custom hardware manager.',
      selinuxContext: 'system_app'
    },
    {
      id: 'custom_sensor_service',
      name: 'ColorSensorService Manager',
      layer: 'Framework Services',
      type: 'Java System Service',
      description: 'Lives inside system_server. Registers the custom color sensor binder with AOSP ServiceManager, handling client callbacks, JNI mappings, and permission enforcements.',
      selinuxContext: 'system_server_service',
      dependencies: ['custom_sensor_hal'],
      aidlMethods: [
        { name: 'registerCallback', returnType: 'void', parameters: [{ name: 'cb', type: 'IColorCallback', direction: 'in' }] },
        { name: 'getLatestColorData', returnType: 'int[]', parameters: [] },
        { name: 'setSensorSensitivity', returnType: 'boolean', parameters: [{ name: 'level', type: 'int', direction: 'in' }] }
      ]
    },
    {
      id: 'custom_sensor_hal',
      name: 'android.hardware.colorsensor-service',
      layer: 'HAL',
      type: 'C++ AIDL HAL Service',
      description: 'A modern AOSP AIDL Hardware Abstraction Layer. Acts as the stable interface between Java system services and raw native background daemons.',
      selinuxContext: 'hal_colorsensor_default',
      dependencies: ['sensor_daemon'],
      aidlMethods: [
        { name: 'getColorRGB', returnType: 'ColorData', parameters: [] },
        { name: 'enableSensor', returnType: 'void', parameters: [{ name: 'enable', type: 'boolean', direction: 'in' }] }
      ]
    },
    {
      id: 'sensor_daemon',
      name: 'colorsensord Daemon',
      layer: 'Native Daemons',
      type: 'Native C++ System Daemon',
      description: 'Low-level background native daemon written in C++. It communicates with kernel filesystems, handles uevents, structures coordinates, and serves them via socket or binder to the HAL.',
      selinuxContext: 'sensor_daemon_exec',
      dependencies: ['sensor_driver']
    },
    {
      id: 'sensor_driver',
      name: 'colorsensor_driver',
      layer: 'Kernel',
      type: 'I2C Platform Kernel Driver',
      description: 'Linux platform character device driver. Communicates over raw physical I2C, handles device trees, physical interrupts, and registers character file nodes under /dev/colorsensor.',
      selinuxContext: 'colorsensor_device',
      dependencies: []
    }
  ]);

  const [selectedComponent, setSelectedComponent] = useState<AospComponent | null>(components[1]);

  // Handle generation of actual AOSP code via backend Gemini
  const handleGenerateCode = async (component: AospComponent) => {
    setIsGeneratingCode(true);
    try {
      const response = await fetch('/api/generate-component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentName: component.name,
          componentType: component.type,
          layer: component.layer,
          description: component.description,
          aidlMethods: component.aidlMethods,
          connectedComponents: component.dependencies
        })
      });

      if (!response.ok) {
        throw new Error("Failed to compile target files.");
      }

      const data = await response.json();
      if (data && data.files) {
        setGeneratedFiles(data.files);
        setActiveTab('code'); // Navigate to Code Studio to see the results
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingCode(false);
    }
  };

  // Handle AI refactoring of currently active file
  const handleRefactorCode = async (instruction: string) => {
    if (!selectedComponent || generatedFiles.length === 0) return;
    setIsRefactoringCode(true);
    try {
      const response = await fetch('/api/generate-component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentName: selectedComponent.name,
          componentType: selectedComponent.type,
          layer: selectedComponent.layer,
          description: `${selectedComponent.description}. Modified under these rules: ${instruction}`,
          aidlMethods: selectedComponent.aidlMethods,
          connectedComponents: selectedComponent.dependencies
        })
      });

      if (!response.ok) {
        throw new Error("Failed to refactor file.");
      }

      const data = await response.json();
      if (data && data.files) {
        setGeneratedFiles(data.files);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefactoringCode(false);
    }
  };

  // Pre-load default component files on start so the user is greeted with code
  useEffect(() => {
    if (selectedComponent && generatedFiles.length === 0) {
      handleGenerateCode(selectedComponent);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 flex flex-col font-sans" id="aosp-architect-app-root">
      
      {/* Top Navigation / App Title Header */}
      <header className="border-b border-[#1e293b]/65 bg-[#090d1a] sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/10">
            <Cpu className="text-white w-5.5 h-5.5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white flex items-center gap-2">
              Any Realm <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 font-mono font-bold px-1.5 py-0.5 rounded">Any RealM v1.4</span>
            </h1>
            <p className="text-xs text-slate-400">Design, code, and fuse custom system services, custom HAL drivers, and manage secure people imports.</p>
          </div>
        </div>

        {/* Actions & Tab Selection Wrap */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Tab selection */}
          <div className="flex bg-[#0f172a] border border-[#1e293b] p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('architect')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'architect' 
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-architect-studio"
            >
              <Layers className="w-3.5 h-3.5" />
              Architect Studio
            </button>

            <button
              onClick={() => setActiveTab('fuser')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'fuser' 
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-rootfs-fuser"
            >
              <GitMerge className="w-3.5 h-3.5" />
              Rootfs Fuser
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'code' 
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-code-studio"
            >
              <Code2 className="w-3.5 h-3.5" />
              AOSP Code Studio
            </button>

            <button
              onClick={() => setActiveTab('super')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'super' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-super-partition"
            >
              <Database className="w-3.5 h-3.5" />
              Super Partition (LP & EROFS)
            </button>

            <button
              onClick={() => setActiveTab('automation')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'automation' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-automation-pipeline"
            >
              <Workflow className="w-3.5 h-3.5" />
              Automation & Agents (CI/CD)
            </button>

            <button
              onClick={() => setActiveTab('interpreter')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'interpreter' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-ui-translator-interpreter"
            >
              <Languages className="w-3.5 h-3.5" />
              UI & Translation Interpreter
            </button>

            <button
              onClick={() => setActiveTab('iso_fs')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'iso_fs' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-iso-fs-matrix"
            >
              <HardDrive className="w-3.5 h-3.5" />
              ISO Dissector & FS Matrix
            </button>

            <button
              onClick={() => setActiveTab('firmware')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'firmware' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-carrier-firmware-decomposer"
            >
              <FileArchive className="w-3.5 h-3.5" />
              Stock Firmware Decomposer
            </button>

            <button
              onClick={() => setActiveTab('peoples')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'peoples' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-peoples-importer"
            >
              <Users className="w-3.5 h-3.5" />
              Peoples & Signers
            </button>

            <button
              onClick={() => setActiveTab('aik')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeTab === 'aik' 
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              id="tab-android-image-kitchen"
            >
              <Wrench className="w-3.5 h-3.5" />
              Android Image Kitchen (AIK)
            </button>
          </div>

          <button
            onClick={() => setIsConsoleOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 hover:text-white border border-indigo-500/30 hover:border-indigo-500/50 rounded-lg text-xs font-bold transition-all shadow shadow-indigo-500/5 cursor-pointer"
            id="open-dev-console-btn"
          >
            <Database className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
            Developer Console
          </button>
        </div>
      </header>

      {/* Main Container Wrapper */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-8">
        
        {/* Conceptual Alert of full-stack power */}
        <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/5 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
          <Info className="text-blue-400 w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 leading-relaxed">
            <span className="font-bold text-white block mb-0.5">Dual-System Architecture Fusion Workspace</span>
            This workspace lets you visually map custom AOSP layers and **fuse standard Linux root filesystems (glibc)** into the AOSP runtime hierarchy. This creates unified system images with zero overhead, combining standard Debian/Ubuntu toolchains with stable AOSP low-level HAL services and AIDL interface drivers.
          </div>
        </div>

        {/* Tab view dispatches */}
        <div className="flex-1">
          {activeTab === 'architect' && (
            <AospArchitect
              onSelectComponent={(comp) => {
                setSelectedComponent(comp);
                // Pre-fetch files when selecting a new component
                handleGenerateCode(comp);
              }}
              selectedComponent={selectedComponent}
              components={components}
              setComponents={setComponents}
              onGenerateCode={handleGenerateCode}
              isGenerating={isGeneratingCode}
            />
          )}

          {activeTab === 'fuser' && (
            <RootfsFuser />
          )}

          {activeTab === 'code' && (
            <AospCodeStudio
              files={generatedFiles}
              onRefactor={handleRefactorCode}
              isRefactoring={isRefactoringCode}
              activeComponentId={selectedComponent?.id || ''}
            />
          )}

          {activeTab === 'super' && (
            <SuperPartitionStudio />
          )}

          {activeTab === 'automation' && (
            <AutomationStudio workspaceFiles={generatedFiles} />
          )}

          {activeTab === 'interpreter' && (
            <UiTranslatorInterpreter />
          )}

          {activeTab === 'iso_fs' && (
            <IsoDissectorStudio />
          )}

          {activeTab === 'firmware' && (
            <FirmwareDecomposer />
          )}

          {activeTab === 'peoples' && (
            <PeoplesImporter />
          )}

          {activeTab === 'aik' && (
            <AndroidImageKitchen />
          )}
        </div>
      </main>

      {/* Developer Console Slider Drawer */}
      <DeveloperConsole 
        isOpen={isConsoleOpen} 
        onClose={() => setIsConsoleOpen(false)} 
        activeFiles={generatedFiles} 
      />

      {/* Humble page footer with visual branding */}
      <footer className="border-t border-[#1e293b]/40 py-6 px-6 bg-[#090d1a] text-center text-xs text-slate-500">
        <p>© 2026 Any Realm Workstation. Built with Google Gemini AI integration. Standard AOSP Apache 2.0 license applied.</p>
      </footer>
    </div>
  );
}
