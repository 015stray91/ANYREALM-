/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Code, 
  FileCode, 
  Cpu, 
  RefreshCw, 
  Save, 
  Sparkles, 
  Download, 
  Check, 
  AlertCircle,
  Play,
  HelpCircle,
  Smartphone,
  Eye,
  Layers,
  Settings2,
  FolderOpen,
  Sliders,
  Shield,
  Activity,
  ChevronRight,
  Database
} from 'lucide-react';
import { GeneratedFile } from '../types';

interface AospCodeStudioProps {
  files: GeneratedFile[];
  onRefactor: (instruction: string) => void;
  isRefactoring: boolean;
  activeComponentId: string;
}

interface RomOption {
  id: string;
  name: string;
  codename: string;
  androidVersion: string;
  kernelVersion: string;
  description: string;
}

export default function AospCodeStudio({
  files,
  onRefactor,
  isRefactoring,
  activeComponentId
}: AospCodeStudioProps) {
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [refactorPrompt, setRefactorPrompt] = useState<string>('');
  const [showNotification, setShowNotification] = useState<string | null>(null);

  // ROM source state
  const [selectedRom, setSelectedRom] = useState<string>('aosp-generic');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [currentImportStep, setCurrentImportStep] = useState<string>('');

  // Interactive Live GUI Controls inside the device mockup
  const [guiSensitivity, setGuiSensitivity] = useState<number>(75);
  const [guiColorHex, setGuiColorHex] = useState<string>('#3b82f6');
  const [guiSelinuxEnforced, setGuiSelinuxEnforced] = useState<boolean>(true);
  const [guiPowerState, setGuiPowerState] = useState<boolean>(true);
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const [simulatedLogs, setSimulatedLogs] = useState<string[]>([
    "[init] Service 'colorsensord' started successfully",
    "[colorsensord] Listening for I2C register updates on bus 0x3",
    "[android.hardware.colorsensor] AIDL HAL binder service registered",
    "[system_server] ColorSensorService registered with ServiceManager",
    "[system_app] Bind successful to Context.COLOR_SENSOR_SERVICE"
  ]);

  // Integrated VS Code Output Terminal state
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const [isWsCompiling, setIsWsCompiling] = useState(false);
  const [githubOwner, setGithubOwner] = useState('slm91-sg');
  const [githubRepo, setGithubRepo] = useState('kiosity-appliance-os');
  const [activeConsoleTab, setActiveConsoleTab] = useState<'terminal' | 'github_actions'>('terminal');

  const handleTriggerGithubCompile = () => {
    if (isWsCompiling) return;
    setIsWsCompiling(true);
    setWsLogs([]);
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${protocol}//${window.location.host}/`;
    
    setWsLogs(prev => [...prev, `[*] Connecting to Any Realm Daemon at ${socketUrl}...`]);
    
    try {
      const ws = new WebSocket(socketUrl);
      
      ws.onopen = () => {
        setWsLogs(prev => [...prev, `[SUCCESS] Secure WebSocket connected.`]);
        setWsLogs(prev => [...prev, `[*] Offloading build transaction to GitHub Actions for ${githubOwner}/${githubRepo}...`]);
        
        ws.send(JSON.stringify({
          action: "COMPILE_VENTOY_ISO",
          params: {
            owner: githubOwner,
            repo: githubRepo
          }
        }));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'COMPILE_LOG') {
            setWsLogs(prev => [...prev, data.line]);
          } else if (data.type === 'COMPILE_STATUS') {
            setIsWsCompiling(false);
            if (data.success) {
              setWsLogs(prev => [...prev, `[SUCCESS] GitHub Action compilation run successfully triggered!`]);
            } else {
              setWsLogs(prev => [...prev, `[ERROR] GitHub Action triggering failed or returned non-200. Confirm credentials.`]);
            }
            ws.close();
          }
        } catch (e) {
          console.error("Error reading websocket message:", e);
        }
      };
      
      ws.onerror = (err) => {
        setWsLogs(prev => [...prev, `[ERROR] WebSocket connection transmission fault.`]);
        setIsWsCompiling(false);
      };
      
      ws.onclose = () => {
        setWsLogs(prev => [...prev, `[*] Live build log session closed.`]);
        setIsWsCompiling(false);
      };
      
    } catch (e: any) {
      setWsLogs(prev => [...prev, `[ERROR] Failed to instantiate socket: ${e.message}`]);
      setIsWsCompiling(false);
    }
  };

  const roms: RomOption[] = [
    {
      id: 'aosp-generic',
      name: 'Pixel Core Generic Board ROM',
      codename: 'aosp_phone_arm64',
      androidVersion: 'Android 14 (U)',
      kernelVersion: '6.1.25-android14-gki',
      description: 'A stable baseline source code tree based on Google GKI, targeting standardized dynamic partition device images.'
    },
    {
      id: 'pinephone-hybrid',
      name: 'PinePhone Linux-AOSP Hybrid OS',
      codename: 'pinephone_hybrid_glibc',
      androidVersion: 'AOSP + Ubuntu 22.04',
      kernelVersion: '5.15.110-custom-sunxi',
      description: 'Unified rootfs merging standard glibc developer packages alongside native Android vendor/system hardware layers.'
    },
    {
      id: 'automotive-dashboard',
      name: 'AOSP Automotive IVI Dashboard',
      codename: 'car_ui_x86_64',
      androidVersion: 'Android Automotive 14',
      kernelVersion: '5.19.45-chromeos-ivi',
      description: 'Dual display cluster architecture compiling native HVAC dials, custom instrument clusters, and CAN bus vehicle telemetry.'
    }
  ];

  const activeFile = files[activeFileIndex] || null;

  // Link hotspot selections to specific generated code blocks
  const handleHotspotClick = (hotspot: string) => {
    setActiveHotspot(hotspot);
    
    // Find matching files based on current generated workspace
    let targetIndex = -1;
    if (hotspot === 'app-ui') {
      targetIndex = files.findIndex(f => f.filename.toLowerCase().includes('app') || f.filename.toLowerCase().includes('activity') || f.filename.toLowerCase().includes('main'));
      addSimulatedLog("[system_app] user touched UI Canvas hotspot. Dispatched onColorDetected() to background binder thread.");
    } else if (hotspot === 'java-service') {
      targetIndex = files.findIndex(f => f.filename.toLowerCase().includes('service') && f.language === 'java');
      addSimulatedLog("[system_server] Hotspot call: Checking MANAGE_COLOR_SENSOR permission checks on caller UID.");
    } else if (hotspot === 'aidl-interface') {
      targetIndex = files.findIndex(f => f.filename.toLowerCase().includes('aidl'));
      addSimulatedLog("[binder_ipc] AIDL Interface callback registered dynamically by client thread.");
    } else if (hotspot === 'selinux-rules') {
      targetIndex = files.findIndex(f => f.filename.toLowerCase().includes('.te'));
      addSimulatedLog("[selinux] Audit policy lookup context checked: 'u:r:system_app:s0' accessing service.");
    } else if (hotspot === 'native-driver') {
      targetIndex = files.findIndex(f => f.filename.toLowerCase().includes('bp') || f.filename.toLowerCase().includes('cpp') || f.filename.toLowerCase().includes('h') || f.filename.toLowerCase().includes('driver'));
      addSimulatedLog("[kernel_driver] i2c_smbus_read_block updated raw device registry buffer.");
    }

    if (targetIndex !== -1) {
      setActiveFileIndex(targetIndex);
    }
  };

  const addSimulatedLog = (msg: string) => {
    setSimulatedLogs(prev => [...prev.slice(-4), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Import ROM trigger simulation
  const handleImportRom = (romId: string) => {
    setIsImporting(true);
    setSelectedRom(romId);
    setCurrentImportStep('Initializing Git clone of AOSP ROM source repository...');

    setTimeout(() => {
      setCurrentImportStep('Parsing Android.bp files, SELinux policy nodes, and framework files...');
      setTimeout(() => {
        setCurrentImportStep('Generating local workspace blueprints...');
        setTimeout(() => {
          setIsImporting(false);
          addSimulatedLog(`[*] Imported target ROM workspace: ${roms.find(r => r.id === romId)?.name}`);
        }, 1000);
      }, 1000);
    }, 1200);
  };

  const triggerCopy = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setShowNotification('Copied to clipboard!');
    setTimeout(() => setShowNotification(null), 2500);
  };

  const triggerDownload = () => {
    if (!activeFile) return;
    const element = document.createElement("a");
    const file = new Blob([activeFile.content], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = activeFile.filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setShowNotification('Downloaded file!');
    setTimeout(() => setShowNotification(null), 2500);
  };

  const handleRefactorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refactorPrompt.trim()) return;
    onRefactor(refactorPrompt);
    setRefactorPrompt('');
  };

  return (
    <div className="flex flex-col gap-6" id="code-studio-workspace">
      
      {/* ROM Workspace Repository Selector */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold font-mono rounded">
              ROM SOURCES ENGINE
            </span>
            <h3 className="text-lg font-bold text-white mt-1.5 flex items-center gap-2">
              <FolderOpen className="text-blue-500 w-5 h-5" /> Import AOSP Platform ROM
            </h3>
            <p className="text-xs text-slate-400 mt-1">Select an existing custom ROM source repository tree to populate development blueprints.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            {roms.map((rom) => (
              <button
                key={rom.id}
                onClick={() => handleImportRom(rom.id)}
                disabled={isImporting}
                className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer min-w-[200px] flex-1 ${
                  selectedRom === rom.id 
                    ? 'bg-blue-500/10 border-blue-500 text-white' 
                    : 'bg-slate-950 border-[#1e293b] hover:border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs truncate">{rom.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                  <span>{rom.codename}</span>
                  <span>•</span>
                  <span>{rom.androidVersion}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ROM importing state log */}
        {isImporting && (
          <div className="mt-4 p-3 bg-slate-950 rounded-lg border border-blue-500/30 flex items-center gap-3 animate-pulse">
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            <span className="text-xs font-mono text-blue-300">{currentImportStep}</span>
          </div>
        )}
      </div>

      {/* Main Interactive Studio Split Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        
        {/* LEFT COLUMN (4 spans): Foreground Interactive GUI Preview (Phone Mockup) */}
        <div className="xl:col-span-4 bg-[#111827] border border-[#1e293b] rounded-xl p-5 flex flex-col justify-between shadow-xl min-h-[600px]">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-900 pb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold text-slate-200">Device Emulator UI (AOSP Front)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">ADB Over TCP/IP</span>
            </div>
            
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Below is the visual mockup of your custom ROM features. **Click on the highlighted parts** to jump directly to the background system code block responsible for implementing that subsystem!
            </p>

            {/* Simulated Android Device */}
            <div className="relative mx-auto max-w-[280px] bg-slate-950 rounded-[40px] border-4 border-slate-800 p-3 shadow-2xl flex flex-col h-[460px] overflow-hidden">
              {/* Speaker / Camera Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-slate-800 h-4 w-28 rounded-b-xl z-20 flex items-center justify-center gap-1.5">
                <div className="w-8 h-1 bg-slate-700 rounded-full" />
                <div className="w-2 h-2 bg-slate-900 rounded-full" />
              </div>

              {/* Simulated Screen */}
              <div className="flex-1 rounded-[32px] bg-[#0a0a14] overflow-hidden flex flex-col justify-between relative p-3 border border-slate-900">
                
                {/* 1. Status Bar Hotspot */}
                <button
                  onClick={() => handleHotspotClick('aidl-interface')}
                  className={`w-full flex items-center justify-between text-[10px] font-mono px-2 py-1.5 rounded transition-all cursor-pointer ${
                    activeHotspot === 'aidl-interface' 
                      ? 'bg-indigo-500/20 ring-1 ring-indigo-500 text-indigo-300' 
                      : 'hover:bg-slate-900 text-slate-400'
                  }`}
                  title="AOSP AIDL IPC Interface Binder"
                >
                  <div className="flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-indigo-400 animate-pulse" />
                    <span>AIDL Service</span>
                  </div>
                  <span>100% IPC Live</span>
                </button>

                {/* Simulated Android Custom App UI Hotspot */}
                <div className="flex-1 flex flex-col justify-center gap-3 my-4">
                  
                  {/* Dynamic ColorPicker Mockup inside AOSP App */}
                  <button
                    onClick={() => handleHotspotClick('app-ui')}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                      activeHotspot === 'app-ui'
                        ? 'bg-blue-500/10 border-blue-500 ring-1 ring-blue-500'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest block mb-1">ColorPicker System App</span>
                    
                    {/* Live Preview interactive colors */}
                    <div className="flex justify-center gap-1.5 my-2">
                      {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'].map((color) => (
                        <div
                          key={color}
                          onClick={(e) => {
                            e.stopPropagation();
                            setGuiColorHex(color);
                            addSimulatedLog(`[system_app] touched canvas color ${color}. Writing raw RGB coordinates to binder interface.`);
                          }}
                          style={{ backgroundColor: color }}
                          className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                            guiColorHex === color ? 'ring-2 ring-white border border-slate-950 scale-115' : ''
                          }`}
                        />
                      ))}
                    </div>

                    <span className="text-[10px] text-slate-300 block font-mono">Detected Color: {guiColorHex}</span>
                  </button>

                  {/* Core Java Manager Hotspot */}
                  <button
                    onClick={() => handleHotspotClick('java-service')}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      activeHotspot === 'java-service'
                        ? 'bg-emerald-500/10 border-emerald-500'
                        : 'bg-slate-900/40 border-slate-900 hover:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">ColorSensorService</span>
                      <Sliders className="w-3 h-3 text-emerald-400" />
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[9px] text-slate-400">
                        <span>Sensitivity level</span>
                        <span>{guiSensitivity}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={guiSensitivity}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setGuiSensitivity(parseInt(e.target.value));
                          addSimulatedLog(`[system_server] JNI binder call: Setting hardware sensitivity threshold to ${e.target.value}%`);
                        }}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                  </button>

                  {/* SELinux Enforcement Guard status hotspot */}
                  <button
                    onClick={() => handleHotspotClick('selinux-rules')}
                    className={`p-2 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                      activeHotspot === 'selinux-rules'
                        ? 'bg-amber-500/10 border-amber-500'
                        : 'bg-slate-900/30 border-slate-900 hover:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-300">
                      <Shield className={`w-3.5 h-3.5 ${guiSelinuxEnforced ? 'text-amber-500' : 'text-slate-500'}`} />
                      <span>SELinux: <span className="font-mono text-amber-400">{guiSelinuxEnforced ? "Enforcing" : "Permissive"}</span></span>
                    </div>

                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        setGuiSelinuxEnforced(!guiSelinuxEnforced);
                        addSimulatedLog(`[selinux] changed state to: ${!guiSelinuxEnforced ? "Permissive" : "Enforcing"}. Checking audit logs.`);
                      }}
                      className={`w-6 h-3 rounded-full transition-colors cursor-pointer p-0.5 ${guiSelinuxEnforced ? 'bg-amber-500' : 'bg-slate-700'}`}
                    >
                      <div className={`w-2 h-2 rounded-full bg-slate-950 transition-transform ${guiSelinuxEnforced ? 'translate-x-3' : ''}`} />
                    </div>
                  </button>
                </div>

                {/* 5. Kernel Driver File Nodes Hotspot */}
                <button
                  onClick={() => handleHotspotClick('native-driver')}
                  className={`w-full p-2 bg-slate-900/80 border text-left rounded-xl transition-all cursor-pointer ${
                    activeHotspot === 'native-driver'
                      ? 'bg-rose-500/15 border-rose-500 text-rose-300 font-mono'
                      : 'border-slate-900 hover:border-slate-800 text-slate-400 font-mono text-[9px]'
                  }`}
                  title="Low level driver character device /dev node file"
                >
                  <div className="flex items-center justify-between text-[8px] text-slate-500 mb-0.5">
                    <span>DRIVER: /dev/colorsensor</span>
                    <Activity className="w-3 h-3 text-rose-500 animate-pulse" />
                  </div>
                  <div className="flex justify-between font-mono text-[8.5px] text-slate-300">
                    <span>REG_BUFFER: [0x3B, 0x82, 0xF6]</span>
                    <span className="text-rose-400">i2c-bus: ok</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Device Active SysLog monitor terminal */}
          <div className="mt-5 pt-3 border-t border-slate-900">
            <div className="flex items-center gap-1.5 mb-2">
              <Terminal className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-mono">Interactive Syslog (Logcat)</span>
            </div>
            <div className="bg-slate-950/80 p-2.5 rounded border border-slate-900 font-mono text-[9.5px] leading-normal text-slate-400 space-y-1.5 h-[110px] overflow-y-auto">
              {simulatedLogs.map((log, idx) => (
                <div key={idx} className="truncate">
                  <span className="text-blue-500">ADB:</span> {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (8 spans): Background Editor (Code Panel) */}
        <div className="xl:col-span-8 bg-[#0b0f19] border border-[#1e293b] rounded-xl overflow-hidden flex flex-col justify-between shadow-2xl">
          
          {/* Header Action bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 bg-[#111827] border-b border-[#1e293b] gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-bold font-mono rounded border border-blue-500/20">
                  AOSP WORKSPACE IDE
                </span>
                {activeHotspot && (
                  <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-[10px] font-mono rounded">
                    Linked to: {activeHotspot}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Code className="text-blue-500 w-5 h-5" /> AOSP Platform Source Code Studio
              </h2>
            </div>

            <div className="flex items-center gap-2">
              {showNotification && (
                <span className="text-xs text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded">
                  {showNotification}
                </span>
              )}
              
              <button
                onClick={triggerCopy}
                disabled={!activeFile}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold rounded-lg text-slate-300 disabled:opacity-50 transition-all cursor-pointer"
                id="copy-code-btn"
              >
                Copy Code
              </button>

              <button
                onClick={triggerDownload}
                disabled={!activeFile}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold rounded-lg text-slate-300 disabled:opacity-50 transition-all cursor-pointer"
                id="download-code-btn"
              >
                Download
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 flex-1">
            
            {/* Left file explorer index */}
            <div className="md:col-span-3 bg-[#0d1321] border-r border-[#1e293b] p-4 flex flex-col gap-4">
              <div>
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Terminal className="w-3 h-3" /> Workspace ROM Tree
                </h3>
                
                <div className="space-y-1">
                  {files.map((file, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setActiveFileIndex(idx);
                        setActiveHotspot(null);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[11px] font-mono transition-all cursor-pointer ${
                        activeFileIndex === idx 
                          ? 'bg-blue-500/10 text-white border border-blue-500/30' 
                          : 'text-slate-400 hover:bg-slate-900/60 border border-transparent'
                      }`}
                      id={`file-tab-${idx}`}
                    >
                      <FileCode className={`w-3.5 h-3.5 ${activeFileIndex === idx ? 'text-blue-400' : 'text-slate-500'}`} />
                      <div className="truncate flex-1">
                        <span className="block text-slate-200 truncate font-semibold">{file.filename}</span>
                        <span className="text-[9px] text-slate-500 block truncate font-sans mt-0.5">{file.path}</span>
                      </div>
                    </button>
                  ))}

                  {files.length === 0 && (
                    <div className="text-center p-6 text-xs text-slate-500">
                      Select a component in the Architect Map and compile its code!
                    </div>
                  )}
                </div>
              </div>

              {activeFile && (
                <div className="mt-auto bg-slate-950/60 p-3 rounded-lg border border-slate-900 text-[11px] leading-relaxed text-slate-400">
                  <span className="font-bold text-slate-300 block mb-1">AOSP Destination:</span>
                  <span className="font-mono text-[9.5px] text-blue-400 block break-all mb-2 bg-slate-950 p-1.5 rounded">
                    aosp_tree/{activeFile.path}
                  </span>
                  <p className="text-[10px]">Move this verified platform source file into your Android ROM builds tree to run compiler binaries.</p>
                </div>
              )}
            </div>

            {/* Center Code Editor view with dynamic code contents */}
            <div className="md:col-span-6 bg-slate-950 p-4 flex flex-col border-r border-[#1e293b] justify-between">
              {activeFile ? (
                <div className="flex-1 flex flex-col h-full justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                      <span className="text-[10.5px] font-mono text-slate-400 truncate max-w-[200px]">{activeFile.path}</span>
                      <span className="text-[9px] font-mono bg-slate-900 text-slate-500 px-2 py-0.5 rounded uppercase shrink-0">
                        {activeFile.language}
                      </span>
                    </div>

                    {/* Interactive Hotspot Focus Highlights */}
                    {activeHotspot && (
                      <div className="bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-300 rounded p-2 mb-3 flex items-center justify-between">
                        <span>Showing matching method declarations for GUI element: <strong>{activeHotspot}</strong></span>
                        <button onClick={() => setActiveHotspot(null)} className="text-slate-500 hover:text-slate-300">✕</button>
                      </div>
                    )}
                  </div>

                  <textarea
                    readOnly
                    className="w-full flex-1 bg-transparent text-slate-300 font-mono text-[11.5px] leading-relaxed resize-none focus:outline-none scrollbar-thin scrollbar-thumb-slate-850 h-[220px]"
                    style={{ tabSize: 4 }}
                    value={activeFile.content}
                    id="active-file-editor"
                  />
                  
                  <div className="pt-2 pb-2 text-[10px] text-slate-500 font-mono text-right border-b border-slate-900/60">
                    Lines: {activeFile.content.split('\n').length}
                  </div>

                  {/* Integrated VS Code-like Bottom Terminal / Actions Panel */}
                  <div className="mt-3 pt-1 flex flex-col gap-2">
                    <div className="flex items-center justify-between border-b border-slate-900 pb-1">
                      <div className="flex items-center gap-4">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">OUTPUT CHANNELS</span>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setActiveConsoleTab('terminal')}
                            className={`px-2 py-0.5 text-[9.5px] font-semibold rounded cursor-pointer ${activeConsoleTab === 'terminal' ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-500 hover:text-slate-300'}`}
                          >
                            Local Terminal
                          </button>
                          <button 
                            onClick={() => setActiveConsoleTab('github_actions')}
                            className={`px-2 py-0.5 text-[9.5px] font-semibold rounded cursor-pointer ${activeConsoleTab === 'github_actions' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300'}`}
                          >
                            GitHub Actions (Live ISO Compile)
                          </button>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono text-slate-600">Secure Client Ingress</span>
                    </div>

                    {activeConsoleTab === 'terminal' && (
                      <div className="bg-black/40 p-2 rounded border border-slate-900/50 font-mono text-[9px] text-slate-400 h-[100px] overflow-y-auto space-y-1">
                        <div>$ aosp-build-daemon --status</div>
                        <div className="text-blue-400">[DAEMON] Workspace edits captured successfully. Writable overlay persistent.</div>
                        <div className="text-emerald-400">[DAEMON] Active files tracked: {files.length}</div>
                        <div className="text-slate-500">[HINT] Target building can be triggered directly in the adjacent tab.</div>
                      </div>
                    )}

                    {activeConsoleTab === 'github_actions' && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded border border-slate-900/60">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9.5px] font-mono text-slate-500">Repo:</span>
                            <input 
                              type="text" 
                              value={githubOwner} 
                              onChange={(e) => setGithubOwner(e.target.value)}
                              className="bg-slate-900 border border-slate-800 text-[9.5px] px-1.5 py-0.5 rounded text-slate-200 w-16" 
                              placeholder="owner"
                            />
                            <span className="text-[9.5px] font-mono text-slate-500">/</span>
                            <input 
                              type="text" 
                              value={githubRepo} 
                              onChange={(e) => setGithubRepo(e.target.value)}
                              className="bg-slate-900 border border-slate-800 text-[9.5px] px-1.5 py-0.5 rounded text-slate-200 w-28" 
                              placeholder="repository"
                            />
                          </div>
                          
                          <button
                            onClick={handleTriggerGithubCompile}
                            disabled={isWsCompiling}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-[9px] rounded cursor-pointer transition-colors"
                          >
                            {isWsCompiling ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Play className="w-2.5 h-2.5" />}
                            {isWsCompiling ? "Compiling..." : "🚀 Dispatch Actions"}
                          </button>
                        </div>

                        <div className="bg-black/60 p-2 rounded border border-slate-900/60 font-mono text-[9px] text-slate-300 h-[80px] overflow-y-auto space-y-1 scrollbar-none">
                          {wsLogs.length === 0 ? (
                            <div className="text-slate-500 italic">No live logs. Click 'Dispatch Actions' to run workflow compile on your repo.</div>
                          ) : (
                            wsLogs.map((line, i) => (
                              <div key={i} className={`truncate ${line.startsWith('[SUCCESS]') || line.includes('successful') ? 'text-emerald-400 font-bold' : line.startsWith('[ERR') || line.includes('ERROR') ? 'text-red-400' : line.startsWith('[SENDING') || line.includes('Offloading') ? 'text-blue-400' : 'text-slate-300'}`}>
                                {line}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 h-[380px]">
                  <FileCode className="w-12 h-12 text-slate-800 mb-3 animate-pulse" />
                  <h3 className="text-slate-400 font-bold mb-1 text-sm">No ROM Code Selected</h3>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Select a file on the left file explorer or click on the interactive phone GUI hotspot to load the ROM framework file code blocks.
                  </p>
                </div>
              )}
            </div>

            {/* Right Side Smart AI Refactoring assistant */}
            <div className="md:col-span-3 bg-[#0d1321] p-4 flex flex-col gap-4">
              <h3 className="text-[10.5px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="text-amber-400 w-4 h-4 animate-pulse" /> Smart Refactoring
              </h3>

              <p className="text-xs text-slate-400 leading-relaxed">
                Prompt Gemini to safely update this platform file. You can add permission controls, register listeners, optimize memory, or include custom error handling.
              </p>

              <form onSubmit={handleRefactorSubmit} className="space-y-3 mt-1">
                <textarea
                  required
                  disabled={isRefactoring || !activeFile}
                  placeholder="e.g. Add permission check to make sure calling app has MANAGE_COLOR_SENSOR permission."
                  value={refactorPrompt}
                  onChange={(e) => setRefactorPrompt(e.target.value)}
                  className="w-full bg-slate-950 border border-[#1e293b] hover:border-slate-800 focus:border-blue-500 rounded-lg p-3 text-xs text-slate-200 focus:outline-none min-h-[120px] resize-none disabled:opacity-50"
                />

                <button
                  type="submit"
                  disabled={isRefactoring || !activeFile}
                  className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-xs transition-all cursor-pointer"
                  id="refactor-with-gemini"
                >
                  {isRefactoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {isRefactoring ? "Refactoring Platform Code..." : "Apply Refactor"}
                </button>
              </form>

              {/* Suggestions list shortcuts */}
              {activeFile && (
                <div className="space-y-2 mt-2 pt-3 border-t border-slate-900">
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">Refactoring Suggestions</span>
                  
                  <button
                    onClick={() => setRefactorPrompt("Add comprehensive security check to ensure only the system server can bind to this service.")}
                    className="w-full text-left p-2 rounded bg-slate-950 hover:bg-slate-900 text-[10px] text-slate-400 border border-slate-900 transition-colors cursor-pointer"
                  >
                    🔒 Add system-server binding checks
                  </button>

                  <button
                    onClick={() => setRefactorPrompt("Add complete Doxygen style comments and licensing header to match standard Android AOSP guidelines.")}
                    className="w-full text-left p-2 rounded bg-slate-950 hover:bg-slate-900 text-[10px] text-slate-400 border border-slate-900 transition-colors cursor-pointer"
                  >
                    📝 Add AOSP license headers & docs
                  </button>

                  <button
                    onClick={() => setRefactorPrompt("Optimize memory allocation in the C++ / binder exchange to minimize garbage collection latency.")}
                    className="w-full text-left p-2 rounded bg-slate-950 hover:bg-slate-900 text-[10px] text-slate-400 border border-slate-900 transition-colors cursor-pointer"
                  >
                    ⚡ Optimize low-latency allocations
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
