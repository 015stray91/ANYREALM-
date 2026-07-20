/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  FileArchive, 
  Upload, 
  Download, 
  Layers, 
  Cpu, 
  FolderOpen, 
  Terminal, 
  Play, 
  RefreshCw, 
  Settings2, 
  ShieldCheck, 
  Trash2, 
  ChevronRight, 
  Info,
  CheckCircle2,
  AlertCircle,
  Copy,
  Plus,
  Compass,
  FileCode,
  Sliders,
  Flame,
  Search,
  Check,
  Eye,
  Lock
} from 'lucide-react';

interface CarrierPreset {
  id: string;
  carrier: string;
  model: string;
  version: string;
  filename: string;
  size: string;
  partitions: string[];
}

interface ExtractedPartition {
  name: string;
  size: string;
  format: 'sparse_ext4' | 'erofs' | 'raw_img' | 'boot_img';
  status: 'packed' | 'extracted' | 'analyzed';
  carrierBloatRating: 'High' | 'Medium' | 'Low' | 'None';
  keepInBuild: boolean;
  bloatwareCount: number;
}

export default function FirmwareDecomposer() {
  // Carrier presets for fast user onboarding / simulation
  const carrierPresets: CarrierPreset[] = [
    {
      id: 'tmobile-s24',
      carrier: 'T-Mobile US',
      model: 'Samsung Galaxy S24 Ultra (SM-S928U)',
      version: 'S928USQS2AXD4_Android14',
      filename: 'AP_S928USQS2AXD4_tar.md5',
      size: '6.45 GB',
      partitions: ['super.img', 'boot.img', 'init_boot.img', 'recovery.img', 'vbmeta.img', 'modem.bin']
    },
    {
      id: 'verizon-pixel8',
      carrier: 'Verizon Wireless',
      model: 'Google Pixel 8 Pro (shiba-vzw)',
      version: 'UD1A.231105.004_A4',
      filename: 'shiba-vzw-factory-ota-payload.zip',
      size: '2.92 GB',
      partitions: ['payload.bin', 'boot.img', 'vendor_kernel_boot.img', 'dtbo.img', 'radio.img']
    },
    {
      id: 'att-moto-edge',
      carrier: 'AT&T Mobility',
      model: 'Motorola Edge 50 (SM-E50_ATT)',
      version: 'U1SD34.12-44-3_V2',
      filename: 'ATT_SM-E50_firmware_dump.zip',
      size: '4.15 GB',
      partitions: ['super.img', 'boot.img', 'vendor.img', 'product.img', 'system.img', 'carrier.img']
    }
  ];

  // Component Sub-Tabs: 'import_extract' | 'carrier_bloat' | 'rebuild_config'
  const [activeSubTab, setActiveSubTab] = useState<'import_extract' | 'carrier_bloat' | 'rebuild_config'>('import_extract');

  // Selected Preset or manual upload file state
  const [selectedPresetId, setSelectedPresetId] = useState<string>('verizon-pixel8');
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: string; type: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Decomposing status state
  const [isDecomposing, setIsDecomposing] = useState<boolean>(false);
  const [decomposeProgress, setDecomposeProgress] = useState<number>(0);
  const [decomposeStep, setDecomposeStep] = useState<string>('Idle');
  const [decompilerLogs, setDecompilerLogs] = useState<string[]>([]);
  const [isDecomposed, setIsDecomposed] = useState<boolean>(false);

  // Extracted partitions listing state
  const [partitions, setPartitions] = useState<ExtractedPartition[]>([]);

  // Bloatware analyzer states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [carrierBloatList, setCarrierBloatList] = useState<Array<{
    id: string;
    packageName: string;
    displayName: string;
    size: string;
    path: string;
    category: 'carrier_app' | 'telemetry' | 'visual_branding' | 'ota_enforcer';
    action: 'strip' | 'keep' | 'debloat_stub';
    description: string;
  }>>([
    { id: 'vzw-myverizon', packageName: 'com.vzw.applications.customercare', displayName: 'My Verizon Portal', size: '48.5 MB', path: '/product/app/MyVerizon/', category: 'carrier_app', action: 'strip', description: 'Account helper portal. Continuously syncs customer telemetry logs in the background.' },
    { id: 'vzw-cloud', packageName: 'com.vzw.cloud.backup', displayName: 'Verizon Cloud Sync', size: '36.2 MB', path: '/product/app/VerizonCloud/', category: 'carrier_app', action: 'strip', description: 'Proprietary cloud storage application. Redundant with Google Drive backups.' },
    { id: 'vzw-location', packageName: 'com.vzw.location.service', displayName: 'Verizon Location Tracker', size: '4.8 MB', path: '/system_ext/priv-app/VzwLocationService/', category: 'telemetry', action: 'strip', description: 'Carrier-specific location profiling services. Overrides standard Android framework APIs.' },
    { id: 'dt-ignite', packageName: 'com.digitalturbines.ignite.partner', displayName: 'Digital Turbine (Ignite)', size: '12.4 MB', path: '/vendor/operator/app/IgniteStub/', category: 'ota_enforcer', action: 'strip', description: 'Silent bloatware downloader. Background daemon responsible for auto-installing partner games during activation.' },
    { id: 'att-live', packageName: 'com.att.android.tv.live', displayName: 'AT&T Live TV Playback', size: '52.0 MB', path: '/product/app/AttLiveTV/', category: 'carrier_app', action: 'strip', description: 'AT&T media streams utility. Non-removable carrier system app.' },
    { id: 'tmo-app', packageName: 'com.tmobile.pr.mytmobile', displayName: 'T-Mobile Account Central', size: '42.1 MB', path: '/product/app/MyTMobile/', category: 'carrier_app', action: 'strip', description: 'Carrier portal app. Tracks hardware device states and executes targeted notification prompts.' },
    { id: 'tmo-visual-voicemail', packageName: 'com.tmobile.vvm.application', displayName: 'T-Mobile Visual Voicemail', size: '18.4 MB', path: '/system_ext/app/TmoVisualVoicemail/', category: 'debloat_stub', action: 'debloat_stub', description: 'T-Mobile visual voicemail. Stubbing keeps framework references intact while removing binary payload.' }
  ]);

  // Terminal state for custom command inputs
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [terminalInput, setTerminalInput] = useState<string>('');

  // Rebuilding parameters
  const [keepCarrierApns, setKeepCarrierApns] = useState<boolean>(true);
  const [keepModemFirmware, setKeepModemFirmware] = useState<boolean>(true);
  const [injectMagiskRoot, setInjectMagiskRoot] = useState<boolean>(false);
  const [applyDmVerityStrip, setApplyDmVerityStrip] = useState<boolean>(true);
  const [systemPartitionFormat, setSystemPartitionFormat] = useState<'erofs' | 'ext4' | 'f2fs'>('erofs');

  // Triggering firmware decompiler pipeline simulation
  const handleStartDecompilation = () => {
    if (isDecomposing) return;
    setIsDecomposing(true);
    setIsDecomposed(false);
    setDecomposeProgress(0);
    setDecompilerLogs([]);

    const selectedFile = uploadedFile ? uploadedFile.name : carrierPresets.find(p => p.id === selectedPresetId)?.filename || 'AP_Samsung_Stock.tar.md5';
    const isZipOta = selectedFile.endsWith('.zip') || selectedFile.includes('payload');
    const isSamsungTar = selectedFile.includes('tar.md5');

    const steps = [
      { step: 'Initializing Workspace', log: `[*] Creating isolated scratch directory for firmware extraction...` },
      { step: 'Validating Signature', log: `[*] Scanning header signatures of firmware file [${selectedFile}]...` },
      { step: 'Unpacking Archive', log: isSamsungTar 
        ? `[+] Samsung ODIN Tar package verified. Extracting LZ4 compressed partition frames (tar -xf ${selectedFile})...`
        : `[+] OTA Zip container detected. Sifting archive nodes for 'payload.bin' or raw firmware images...` },
      { step: 'Dumping payload.bin', log: isZipOta 
        ? `[*] Executing payload-dumper-go on input payload (payload-dumper-go -o ./extracted_ota/ payload.bin)...` 
        : `[*] Parsing raw super block structure inside super.img...` },
      { step: 'Unpacking Super Partition', log: `[*] Running lpunpack to dissect logical partitions from super container (lpunpack ./super.img ./partitions/)...` },
      { step: 'Extracting system.img', log: `[+] lpunpack: Extracted system.img (Size: 1.84 GB) successfully. Parsing file system table...` },
      { step: 'Extracting vendor.img', log: `[+] lpunpack: Extracted vendor.img (Size: 520 MB) successfully. Decoding HAL profiles...` },
      { step: 'Extracting product.img', log: `[+] lpunpack: Extracted product.img (Size: 1.15 GB). This block contains localized carrier parameters.` },
      { step: 'Extracting modem.bin', log: `[*] Dissecting boot.img kernel RAM disk and carrier modem.bin network drivers...` },
      { step: 'Static Code Analysis', log: `[*] Phase 3: Parsing SELinux file contexts, Carrier configs (apns-conf.xml), and package files...` },
      { step: 'Analysis Completed', log: `[SUCCESS] Carrier stock firmware unpacked! Discovered 6 vital partitions and 7 customizable carrier bloat packages.` }
    ];

    steps.forEach((s, index) => {
      setTimeout(() => {
        setDecomposeProgress(Math.round(((index + 1) / steps.length) * 100));
        setDecomposeStep(s.step);
        setDecompilerLogs(prev => [...prev, s.log]);
        
        if (index === steps.length - 1) {
          setIsDecomposing(false);
          setIsDecomposed(true);

          // Populate the extracted partitions based on selected model
          setPartitions([
            { name: 'system.img', size: '1.84 GB', format: 'erofs', status: 'analyzed', carrierBloatRating: 'Medium', keepInBuild: false, bloatwareCount: 2 },
            { name: 'vendor.img', size: '520 MB', format: 'erofs', status: 'analyzed', carrierBloatRating: 'None', keepInBuild: true, bloatwareCount: 0 },
            { name: 'product.img', size: '1.15 GB', format: 'erofs', status: 'analyzed', carrierBloatRating: 'High', keepInBuild: true, bloatwareCount: 5 },
            { name: 'boot.img', size: '64 MB', format: 'boot_img', status: 'extracted', carrierBloatRating: 'None', keepInBuild: true, bloatwareCount: 0 },
            { name: 'modem.bin', size: '82 MB', format: 'raw_img', status: 'extracted', carrierBloatRating: 'None', keepInBuild: true, bloatwareCount: 0 },
            { name: 'odm.img', size: '140 MB', format: 'sparse_ext4', status: 'extracted', carrierBloatRating: 'Low', keepInBuild: true, bloatwareCount: 0 }
          ]);
        }
      }, (index + 1) * 350);
    });
  };

  // Drag and Drop files upload handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setUploadedFile({
        name: file.name,
        size: (file.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
        type: file.name.substring(file.name.lastIndexOf('.'))
      });
      setIsDecomposed(false);
    }
  };

  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadedFile({
        name: file.name,
        size: (file.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
        type: file.name.substring(file.name.lastIndexOf('.'))
      });
      setIsDecomposed(false);
    }
  };

  // Toggle partition keeping
  const togglePartitionKeep = (name: string) => {
    setPartitions(prev => prev.map(p => p.name === name ? { ...p, keepInBuild: !p.keepInBuild } : p));
  };

  // Custom terminal simulation
  const handleTerminalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;

    const cmd = terminalInput.trim();
    setTerminalLogs(prev => [...prev, `decompiler@aosp-studio:~$ ${cmd}`]);

    setTimeout(() => {
      if (cmd.startsWith('payload-dumper') || cmd.startsWith('python dumper.py')) {
        setTerminalLogs(prev => [...prev, `[INFO] Parsing payload.bin file sectors...`, `[+] Found partitions: boot, system, vendor, system_ext, product, odm`, `[+] Successfully dump selected partitions.`]);
      } else if (cmd.startsWith('lpunpack')) {
        setTerminalLogs(prev => [...prev, `[INFO] Running sparse logical partition unpacker...`, `[+] Decomposing super.img to sector-level images...`]);
      } else if (cmd === 'clear') {
        setTerminalLogs([]);
      } else {
        setTerminalLogs(prev => [...prev, `[CLI] Command executed successfully inside dynamic carrier decompiler container.`, `decompiler@aosp-studio:~$`]);
      }
    }, 450);

    setTerminalInput('');
  };

  // Filtered carrier app lists
  const filteredBloat = carrierBloatList.filter(b => {
    if (searchTerm === '') return true;
    return b.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
           b.packageName.toLowerCase().includes(searchTerm.toLowerCase()) ||
           b.category.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Calculate stats
  const totalBloatwareWeight = carrierBloatList.length * 28.5; // estimated size saved

  // Generated debloat shell script code based on user selections
  const generatedDebloatScript = `#!/bin/bash
# AOSP Carrier Debloat script
# Generated dynamically based on custom user-selected package strips

MOUNT_DIR="./squashfs-root"

echo "Running automated carrier debloat script..."
echo "Extracting targeted packages from system/product tree..."

${carrierBloatList.map(b => {
  if (b.action === 'strip') {
    return `# Removing: ${b.displayName} (${b.packageName})\nrm -rf "\${MOUNT_DIR}${b.path}"\n`;
  } else if (b.action === 'debloat_stub') {
    return `# Stubbing: ${b.displayName}\nrm -rf "\${MOUNT_DIR}${b.path}*.apk"\ntouch "\${MOUNT_DIR}${b.path}stub.apk"\n`;
  } else {
    return `# Keeping: ${b.displayName}\n`;
  }
}).join('\n')}

echo "Refactoring SELinux dynamic file context labels..."
restorecon -R ./squashfs-root/product/app/

echo "Debloat operation complete! Clean system partition ready to pack into EROFS format."
`;

  return (
    <div className="flex flex-col gap-8" id="carrier-firmware-decomposer-workspace">
      
      {/* MAIN TOP TITLE */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <FileArchive className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <FileArchive className="w-3.5 h-3.5 animate-pulse" /> Carrier Firmware Ingest
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <FileArchive className="text-indigo-500 w-7 h-7" /> Stock Carrier Firmware Decomposer
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Import proprietary carrier ROM firmware packages (Odin `.tar.md5`, payload-zipped OTAs). Decompose their sparse partition frames, strip pre-installed bloatware APKs, and build a streamlined system.
            </p>
          </div>

          {/* Sub Navigation */}
          <div className="flex bg-[#0a0d18] border border-[#1e293b] p-1 rounded-xl shrink-0">
            <button
              onClick={() => setActiveSubTab('import_extract')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === 'import_extract'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Upload className="w-3.5 h-3.5" /> 1. Import & Decompose
            </button>

            <button
              onClick={() => setActiveSubTab('carrier_bloat')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === 'carrier_bloat'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" /> 2. Bloatware & APN Stripper
            </button>

            <button
              onClick={() => setActiveSubTab('rebuild_config')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === 'rebuild_config'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" /> 3. Build Configuration
            </button>
          </div>
        </div>
      </div>

      {/* ACTIVE SUB-TAB CONTENTS */}

      {/* SUB-TAB 1: IMPORT & DECOMPOSE */}
      {activeSubTab === 'import_extract' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* LEFT COLUMN: IMPORT & DRAG-AND-DROP WORKSPACE (GUI) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">1</span>
                  Import Proprietary Carrier Firmware File (GUI)
                </h3>
                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-bold uppercase">
                  INGEST NODE
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed mb-5">
                Drop your firmware binary package here or choose from our virtual carrier presets (e.g. T-Mobile Samsung Galaxy ROM or Verizon Pixel OTA payload) to test the decompilation pipeline.
              </p>

              {/* Drag and drop panel */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer mb-5 flex flex-col items-center justify-center min-h-[160px] ${
                  isDragOver 
                    ? 'border-indigo-500 bg-indigo-500/5' 
                    : uploadedFile 
                      ? 'border-emerald-500/50 bg-emerald-500/5' 
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <input
                  type="file"
                  id="manual-firmware-file-input"
                  className="hidden"
                  onChange={handleManualUpload}
                  accept=".zip,.tar,.md5,.bin"
                />
                
                <label htmlFor="manual-firmware-file-input" className="cursor-pointer flex flex-col items-center">
                  {uploadedFile ? (
                    <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3 animate-bounce" />
                  ) : (
                    <Upload className="w-12 h-12 text-indigo-400/80 mb-3" />
                  )}
                  
                  <span className="text-xs font-bold text-white">
                    {uploadedFile ? `Firmware Loaded: ${uploadedFile.name}` : "Drag & Drop Carrier firmware ROM file here"}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-1 font-mono">
                    {uploadedFile ? `Size: ${uploadedFile.size} • Format: ${uploadedFile.type}` : "Supports Samsung AP_*.tar.md5, Pixel payload.zip, or raw partition dumps"}
                  </span>
                  
                  {!uploadedFile && (
                    <span className="mt-4 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-[10px] transition-all">
                      Browse Files
                    </span>
                  )}
                </label>
              </div>

              {/* Presets Grid */}
              <div className="space-y-3">
                <span className="text-[10px] font-bold uppercase font-mono text-slate-400 tracking-wider block">Or select Stock Carrier Preset Payload</span>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {carrierPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setSelectedPresetId(preset.id);
                        setUploadedFile(null);
                        setIsDecomposed(false);
                      }}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between h-[110px] ${
                        selectedPresetId === preset.id && !uploadedFile
                          ? 'bg-indigo-600/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/20'
                          : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-850'
                      }`}
                    >
                      <div>
                        <span className="text-[9.5px] font-mono text-indigo-400 font-bold block">{preset.carrier}</span>
                        <span className="font-bold text-xs text-white block mt-0.5 truncate leading-tight">{preset.model}</span>
                      </div>
                      
                      <div className="mt-1 flex items-center justify-between text-[9px] text-slate-500 font-mono w-full">
                        <span>{preset.size}</span>
                        <span className="text-slate-600">Pres: {preset.partitions.length} files</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Trigger button */}
              <div className="mt-6 pt-4 border-t border-slate-900 flex justify-end">
                <button
                  onClick={handleStartDecompilation}
                  disabled={isDecomposing}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold px-6 py-3 rounded-xl text-xs transition-all shadow-lg cursor-pointer shadow-indigo-500/10"
                >
                  {isDecomposing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {isDecomposing ? `Extracting & Decomposing Firmware (${decomposeProgress}%)...` : "Start Firmware Decomposing"}
                </button>
              </div>

            </div>
          </div>

          {/* RIGHT COLUMN: RECONSTRUCTED IMAGES & DECOMPILER SHELL LOGS (Background Code) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-grow flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <Terminal className="w-4 h-4 text-indigo-400" /> Decompiler Engine Terminal (Background)
                  </h3>
                  <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20 font-bold font-mono">
                    AOSP payload-dumper
                  </span>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  The decompiler leverages tools like `lpunpack` and `payload-dumper-go` in the background to separate stock system partitions.
                </p>

                {/* Simulated extracted partition images table */}
                {isDecomposed ? (
                  <div className="space-y-3.5">
                    <span className="text-[10px] font-bold uppercase font-mono text-slate-400 tracking-wider block">Dissected Partition blocks</span>
                    
                    <div className="space-y-2">
                      {partitions.map((p) => (
                        <div 
                          key={p.name} 
                          className="p-3 bg-slate-900/60 rounded-xl border border-slate-900 flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/5 border border-indigo-500/15 flex items-center justify-center text-indigo-400">
                              <Layers className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-xs font-bold text-white block font-mono">{p.name}</span>
                              <div className="flex items-center gap-2 text-[9px] text-slate-500 mt-0.5 font-mono">
                                <span>Format: <strong className="text-slate-300">{p.format}</strong></span>
                                <span>•</span>
                                <span>Size: <strong className="text-slate-300">{p.size}</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                              p.carrierBloatRating === 'High' 
                                ? 'bg-rose-500/10 text-rose-400' 
                                : p.carrierBloatRating === 'Medium' 
                                  ? 'bg-amber-500/10 text-amber-400' 
                                  : 'bg-emerald-500/10 text-emerald-400'
                            }`}>
                              Bloat: {p.carrierBloatRating}
                            </span>
                            
                            <input
                              type="checkbox"
                              checked={p.keepInBuild}
                              onChange={() => togglePartitionKeep(p.name)}
                              className="w-4 h-4 accent-indigo-500 rounded cursor-pointer border-slate-800"
                              title="Select partition to rebuild off of"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : isDecomposing ? (
                  <div className="h-[240px] bg-slate-950/40 rounded-xl border border-slate-900 flex flex-col items-center justify-center text-center p-6 animate-pulse">
                    <Cpu className="w-12 h-12 text-indigo-400 animate-spin mb-3" />
                    <span className="font-bold text-xs text-white">Running lpunpack & payload-dumper...</span>
                    <span className="text-[10px] text-slate-500 mt-1 font-mono">Step: {decomposeStep}</span>
                  </div>
                ) : (
                  <div className="h-[240px] bg-slate-950/40 rounded-xl border border-slate-900 flex flex-col items-center justify-center text-center p-6">
                    <FolderOpen className="w-12 h-12 text-slate-800 mb-2" />
                    <span className="font-bold text-xs text-slate-400">Payload not decomposed yet.</span>
                    <span className="text-[10px] text-slate-600 mt-1">Provide a ROM package and run decompiler to unpack partitions.</span>
                  </div>
                )}
              </div>

              {/* Command logs panel */}
              <div className="pt-4 border-t border-slate-900/80 mt-5 font-mono text-[9.5px] text-slate-500">
                <span className="uppercase font-bold block mb-1">Decompiler output streams</span>
                <div className="bg-[#050811] p-3 rounded-lg border border-slate-900 text-slate-400 h-[105px] overflow-y-auto space-y-1 scrollbar-thin">
                  {decompilerLogs.length > 0 ? (
                    decompilerLogs.map((log, i) => (
                      <div key={i} className="truncate"><span className="text-indigo-400">#</span> {log}</div>
                    ))
                  ) : (
                    <div className="text-slate-700 italic h-full flex items-center justify-center">Log stream is idle. Start decomposer.</div>
                  )}
                </div>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* SUB-TAB 2: CARRIER BLOATWARE APP STRIPPER */}
      {activeSubTab === 'carrier_bloat' && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-900 pb-3 mb-5 gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Trash2 className="w-4.5 h-4.5 text-rose-400" /> Carrier Bloatware App & Telemetry Stripper (GUI)
              </h3>
              <span className="text-xs text-slate-400 block mt-0.5">Filter discovered background bloat, data loggers, and visual carrier branding APK files.</span>
            </div>

            <div className="flex bg-slate-950 border border-slate-900 rounded-lg p-0.5 max-w-sm w-full">
              <span className="pl-3 pr-1 text-slate-500 flex items-center">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                placeholder="Search packages (e.g. verizon)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-transparent border-0 text-xs text-slate-200 py-1.5 focus:outline-none placeholder-slate-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left part: Package selection matrix */}
            <div className="lg:col-span-7 space-y-3.5">
              <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 bg-slate-950/80 p-3 rounded-lg border border-slate-900 mb-2">
                <span>Discovered Bloat APK Packages: <strong className="text-slate-200">{filteredBloat.length} found</strong></span>
                <span>Est. Compressed Space Saved: <strong className="text-rose-400">~{totalBloatwareWeight.toFixed(1)} MB</strong></span>
              </div>

              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
                {filteredBloat.map((b) => (
                  <div 
                    key={b.id} 
                    className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-xs text-white">{b.displayName}</span>
                        <span className={`text-[8.5px] font-mono font-bold px-2 py-0.2 rounded uppercase ${
                          b.category === 'telemetry' 
                            ? 'bg-rose-500/10 text-rose-400' 
                            : b.category === 'ota_enforcer'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-indigo-500/10 text-indigo-300'
                        }`}>
                          {b.category.replace('_', ' ')}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block mt-1">{b.packageName}</span>
                      <p className="text-[10.5px] text-slate-500 mt-1 leading-normal">{b.description}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-slate-400 font-mono">{b.size}</span>
                      <select
                        value={b.action}
                        onChange={(e) => {
                          const action = e.target.value as any;
                          setCarrierBloatList(prev => prev.map(item => item.id === b.id ? { ...item, action } : item));
                        }}
                        className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 font-bold focus:outline-none"
                      >
                        <option value="strip">❌ Strip entirely</option>
                        <option value="debloat_stub">⚙️ Replace with Stub APK</option>
                        <option value="keep">✅ Keep stock APK</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right part: Dynamic shell script output */}
            <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <FileCode className="w-4 h-4 text-rose-400" /> Compiled Debloat Script (Background)
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedDebloatScript);
                      alert('Debloat script copied!');
                    }}
                    className="p-1 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white rounded text-[10px] font-mono transition-colors flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Code
                  </button>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  As you toggle bloat actions, the background compiler compiles a shell debloat script that strips apk paths inside extracted partitions.
                </p>

                <textarea
                  readOnly
                  value={generatedDebloatScript}
                  className="w-full bg-[#050811] text-rose-300 font-mono text-[10.5px] leading-relaxed resize-none p-3.5 rounded-xl border border-slate-900 h-[300px] focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-900 text-[10px] text-slate-500 font-mono flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span>Removing bloat prevents background wakeups and saves massive RAM blocks.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: BUILD CONFIGURATION & MERGING OPTIONS */}
      {activeSubTab === 'rebuild_config' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* LEFT COLUMN: REBUILD OPTIONS CONTROLS (GUI) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4.5 h-4.5 text-indigo-400" /> Configure Rebuild off Stock Carrier ROM (GUI)
                </h3>
                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-bold uppercase">
                  BUILD PREFS
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-normal mb-5">
                Customize parameters used when combining the clean stock partitions with your customized AOSP overlay modules to assemble a fresh unified `super.img` sector file.
              </p>

              {/* Tweak list */}
              <div className="space-y-4">
                
                {/* Preserve APN config */}
                <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                  <div className="flex items-start gap-2 max-w-[340px]">
                    <ShieldCheck className="w-4.5 h-4.5 text-indigo-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-white block">Preserve Carrier APN Database (apns-conf.xml)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Keeps localized carrier APN networks profiles so SIM data and MMS connection works out-of-the-box.</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => setKeepCarrierApns(!keepCarrierApns)}
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 cursor-pointer ${keepCarrierApns ? 'bg-indigo-500' : 'bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${keepCarrierApns ? 'translate-x-4' : ''}`} />
                  </div>
                </div>

                {/* Keep Modem firmware */}
                <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                  <div className="flex items-start gap-2 max-w-[340px]">
                    <Cpu className="w-4.5 h-4.5 text-indigo-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-white block">Preserve Stock Modem & Baseband (modem.bin)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Retains proprietary cellular baseband drivers for reliable radio signal and VoLTE routing.</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => setKeepModemFirmware(!keepModemFirmware)}
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 cursor-pointer ${keepModemFirmware ? 'bg-indigo-500' : 'bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${keepModemFirmware ? 'translate-x-4' : ''}`} />
                  </div>
                </div>

                {/* Strip dm-verity */}
                <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                  <div className="flex items-start gap-2 max-w-[340px]">
                    <Flame className="w-4.5 h-4.5 text-indigo-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-white block">Strip AVB / dm-verity Boot Integrity Seals</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Disables kernel-level partition hashing to allow write access on newly debloated partitions.</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => setApplyDmVerityStrip(!applyDmVerityStrip)}
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 cursor-pointer ${applyDmVerityStrip ? 'bg-indigo-500' : 'bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${applyDmVerityStrip ? 'translate-x-4' : ''}`} />
                  </div>
                </div>

                {/* Inject Magisk Root */}
                <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                  <div className="flex items-start gap-2 max-w-[340px]">
                    <Lock className="w-4.5 h-4.5 text-indigo-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-white block">Inject Magisk / KernelSU Root (boot.img patch)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Injects superuser binaries inside boot.img partition for system rooting privileges.</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => setInjectMagiskRoot(!injectMagiskRoot)}
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 cursor-pointer ${injectMagiskRoot ? 'bg-indigo-500' : 'bg-slate-700'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${injectMagiskRoot ? 'translate-x-4' : ''}`} />
                  </div>
                </div>

                {/* File format selector */}
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1.5">AOSP System Partition File System rebuild format</label>
                  <select
                    value={systemPartitionFormat}
                    onChange={(e) => setSystemPartitionFormat(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="erofs">Huawei EROFS (Optimized read-only size - Stock standard)</option>
                    <option value="ext4">EXT4 (Writable format - ideal for dev bootloader overlays)</option>
                    <option value="f2fs">Samsung F2FS (Fastest read/write - requires kernel drivers support)</option>
                  </select>
                </div>

              </div>
            </div>

            {/* Micro warning indicator */}
            <div className="mt-5 p-3.5 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10.5px] text-slate-400 leading-normal">
                *Stripping AVB/dm-verity requires unlocking the device bootloader first (`fastboot flashing unlock`). Retaining carrier network configs guarantees seamless carrier compatibility.
              </p>
            </div>
          </div>

          {/* RIGHT COLUMN: GENERATED MERGE XML CONFIG (Background Code) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-grow flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <FileCode className="w-4 h-4 text-indigo-400" /> Build Manifest file (Background)
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`<build-manifest>\n ... \n</build-manifest>`);
                      alert('Manifest XML copied!');
                    }}
                    className="p-1 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white rounded text-[10px] font-mono transition-colors flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Code
                  </button>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  The XML manifest file packages custom overlays with the dissected carrier partitions dynamically during automated ROM compilation.
                </p>

                <textarea
                  readOnly
                  value={`<?xml version="1.0" encoding="UTF-8"?>
<firmware-rebuild-profile>
  <base-stock-rom-preset id="${uploadedFile ? 'custom_upload' : selectedPresetId}" />
  
  <partition-rebuilders>
    <partition name="system" action="rebuild" format="${systemPartitionFormat}">
      <debloat-package-strip select="strip_all_user_marked" />
      <security-seal-strip verity="${applyDmVerityStrip ? 'disable' : 'enable'}" />
    </partition>
    
    <partition name="product" action="rebuild">
      <carrier-network-profile apn="${keepCarrierApns ? 'keep_stock' : 'strip_apn_custom'}" />
    </partition>
    
    <partition name="vendor" action="reuse_stock" />
    <partition name="modem" action="${keepModemFirmware ? 'reuse_stock' : 'omit'}" />
    
    <partition name="boot" action="rebuild">
      <magisk-root inject="${injectMagiskRoot ? 'true' : 'false'}" />
    </partition>
  </partition-rebuilders>
  
  <logical-super-allocation-limit size="4294967296">
    <sector-alignment-bytes>4096</sector-alignment-bytes>
    <sparse-mode-image>true</sparse-mode-image>
  </logical-super-allocation-limit>
</firmware-rebuild-profile>`}
                  className="w-full bg-[#050811] text-indigo-300 font-mono text-[10.5px] leading-relaxed resize-none p-3.5 rounded-xl border border-slate-900 h-[280px] focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-900 text-[10px] text-slate-500 font-mono flex justify-between">
                <span>Output Image: <strong className="text-slate-300">super_rebuilt.img</strong></span>
                <span>Config: XML Profiles</span>
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
