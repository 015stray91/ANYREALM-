/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Terminal, 
  Cpu, 
  Workflow, 
  Download, 
  Github, 
  Server, 
  FolderSync, 
  Settings2, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  FileCode, 
  FileCheck, 
  GitBranch, 
  Import, 
  Plus, 
  Trash2, 
  Eye, 
  ShieldCheck, 
  Flame, 
  Share2, 
  Bot, 
  Pocket, 
  Check, 
  Copy,
  ChevronRight
} from 'lucide-react';
import { GeneratedFile } from '../types';

interface AutomationStudioProps {
  workspaceFiles: GeneratedFile[];
}

interface CustomAgent {
  id: string;
  name: string;
  type: 'local' | 'cloud';
  endpoint: string;
  architecture: string;
  threads: number;
  status: 'online' | 'offline' | 'busy';
  lastHeartbeat: string;
}

export default function AutomationStudio({ workspaceFiles }: AutomationStudioProps) {
  // Main target build selector: github_actions, local_agent, cloud_agent
  const [pipelineTarget, setPipelineTarget] = useState<'github_actions' | 'local_agent' | 'cloud_agent'>('github_actions');
  
  // Custom build agents list
  const [agents, setAgents] = useState<CustomAgent[]>([
    {
      id: 'local-desktop-daem',
      name: 'Local Dev Workstation Daemon',
      type: 'local',
      endpoint: 'http://localhost:8080/build-api',
      architecture: 'x86_64 (Ubuntu 24.04)',
      threads: 16,
      status: 'online',
      lastHeartbeat: '2 seconds ago'
    },
    {
      id: 'gcp-compiler-c3d',
      name: 'Google Cloud Compute C3D Node',
      type: 'cloud',
      endpoint: 'https://compiler-node-3a.internal.gcp',
      architecture: 'ARM64 (Ampere Altra)',
      threads: 64,
      status: 'online',
      lastHeartbeat: '15 seconds ago'
    }
  ]);

  // Form states to register a new build agent
  const [agentName, setAgentName] = useState<string>('Custom Studio VM');
  const [agentType, setAgentType] = useState<'local' | 'cloud'>('local');
  const [agentEndpoint, setAgentEndpoint] = useState<string>('http://192.168.1.140:9000');
  const [agentArch, setAgentArch] = useState<string>('ARM64 (aarch64)');
  const [agentThreads, setAgentThreads] = useState<number>(32);

  // Packaging and bundling states
  const [isPackaging, setIsPackaging] = useState<boolean>(false);
  const [packagedFile, setPackagedFile] = useState<{ filename: string; size: string; timestamp: string; filesCount: number } | null>(null);
  const [showPackageContents, setShowPackageContents] = useState<boolean>(false);

  // CI/CD and automation pipeline logs
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<'github' | 'local_agent_config' | 'power_config' | 'readme'>('github');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [powerFormat, setPowerFormat] = useState<'YML' | 'YAML'>('YML');

  // Dynamic dynamic config configurations derived from workspace variables
  const [autoCleanBeforeBuild, setAutoCleanBeforeBuild] = useState<boolean>(true);
  const [ccacheEnabled, setCcacheEnabled] = useState<boolean>(true);
  const [ccacheSizeGb, setCcacheSizeGb] = useState<number>(50);
  const [signingKeyType, setSigningKeyType] = useState<string>('test-keys');

  // Trigger copying of workflow scripts to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback('Copied!');
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  // Automated compiler execution simulation
  const handleExecutePipeline = () => {
    if (isCompiling) return;
    setIsCompiling(true);
    setPipelineProgress(0);
    setPipelineLogs([]);

    const agentNameSelected = pipelineTarget === 'github_actions' 
      ? 'GitHub Actions Hosted Runner (ubuntu-24.04-arm64-16core)' 
      : pipelineTarget === 'local_agent' 
        ? agents.find(a => a.type === 'local')?.name || 'Local Daemon Agent'
        : agents.find(a => a.type === 'cloud')?.name || 'Cloud Compute Compiler';

    const logs = [
      `[*] Connecting to Build Runner: ${agentNameSelected}...`,
      `[SUCCESS] Established secure WebSocket secure transport channel.`,
      `[*] Verifying remote compiler environment capabilities (Checking dynamic partitions utilities)...`,
      `[+] Detected: gcc 13.2, clang 18.0, Python 3.12, lpmake, mkfs.erofs, git, ccache`,
      `[*] Parsing Workspace Bundle configuration package...`,
      `[+] Found ${workspaceFiles.length || 5} active system source definitions and shell build scripts.`,
      `[*] Step 1: Running AOSP pre-build sanity checkers...`,
      `[SUCCESS] Lint verification passed. No cyclic partition dependencies detected.`,
      ccacheEnabled ? `[*] Step 2: Initializing compiler ccache database (Size Limit: ${ccacheSizeGb}GB)...` : `[*] Step 2: Skipping compiler cache initialization (Clean workspace boot)...`,
      `[*] Step 3: Extracting Android GKI common kernel modules and baseline partitions...`,
      `[*] Step 4: Compiling Dynamic HAL services and Binder AIDL linkages (ndk-build)...`,
      `[+] compiled: android.hardware.colorsensor-V1-ndk.so`,
      `[+] compiled: ColorSensorService.jar (framework system-server library)`,
      `[*] Step 5: Packaging Secure Read-Only filesystems using Advanced EROFS assembler (mkfs.erofs)...`,
      `[mkfs.erofs] System.img: compressed to lz4hc algorithm. Block count verified.`,
      `[mkfs.erofs] Vendor.img: parsed platform HAL services safely.`,
      `[mkfs.erofs] Product.img: optimized localized product app allocations.`,
      `[*] Step 6: Linking logical sectors into flashable image (lpmake super)...`,
      `[lpmake] Building unified dynamic super.img container partition table...`,
      `[SUCCESS] super.img layout allocated successfully. Checksum verification match.`,
      `[*] Step 7: Packaging artifacts into target ROM distribution bundle...`,
      `[SUCCESS] Pipeline Execution Complete. Customized Target ROM compiled successfully!`,
      `[SUCCESS] Published dynamic partition binaries: system.img, vendor.img, product.img, super.img`
    ];

    logs.forEach((log, index) => {
      setTimeout(() => {
        setPipelineProgress(Math.round(((index + 1) / logs.length) * 100));
        setPipelineLogs(prev => [...prev, log]);
        if (index === logs.length - 1) {
          setIsCompiling(false);
        }
      }, (index + 1) * 350);
    });
  };

  // Register a new custom build agent to list
  const handleAddAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;

    const newAgent: CustomAgent = {
      id: `custom-agent-${Date.now()}`,
      name: agentName.trim(),
      type: agentType,
      endpoint: agentEndpoint.trim(),
      architecture: agentArch,
      threads: agentThreads,
      status: 'online',
      lastHeartbeat: 'Just now'
    };

    setAgents(prev => [...prev, newAgent]);
    setAgentName('');
    setAgentEndpoint('');
  };

  // Delete/deregister a build agent
  const handleDeleteAgent = (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
  };

  // Simulate bundling/packaging of entire OS Workspace
  const handlePackageWorkspace = () => {
    setIsPackaging(true);
    setPackagedFile(null);

    setTimeout(() => {
      const activeCount = workspaceFiles.length || 5;
      setIsPackaging(false);
      setPackagedFile({
        filename: `aosp_custom_workspace_bundle_${new Date().toISOString().slice(0,10)}.zip`,
        size: `${(2.8 + activeCount * 0.4).toFixed(2)} MB`,
        timestamp: new Date().toLocaleTimeString(),
        filesCount: activeCount + 4 // Adds scripts like mkfs_erofs.sh, fuse_rootfs.sh, lpmake_super.sh
      });
    }, 1500);
  };

  // Generating a highly structured GitHub Actions continuous integration workflow script
  const githubActionsWorkflow = `name: AOSP Custom Dynamic ROM Build
on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

jobs:
  assemble_rom:
    runs-on: ubuntu-24.04-arm64-16core
    steps:
      - name: Checkout Workspace Source Codes
        uses: actions/checkout@v6

      - name: Setup Node.js v24
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install Android Platform Build Dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \\
            libxml2-utils python3-protobuf protobuf-compiler \\
            ccache git-lfs zip unzip android-sdk-libutils EROFS-utils

      - name: Setup Compiler Cache (ccache)
        uses: actions/cache@v4
        with:
          path: ~/.ccache
          key: \${{ runner.os }}-ccache-\${{ github.sha }}
          restore-keys: |
            \${{ runner.os }}-ccache-

      - name: Initialize ccache constraints
        run: |
          ccache -M ${ccacheSizeGb}G
          ccache -s

      - name: Execute Rootfs Fuser Partition Extraction
        run: |
          chmod +x ./fuse_rootfs.sh
          ./fuse_rootfs.sh --partition-scheme=unified --audio=pulseaudio-alsa

      - name: Assemble Logical Filesystem Images (mkfs.erofs)
        run: |
          mkdir -p ./out/target/product/generic
          mkfs.erofs -zlz4hc,9 ./out/target/product/generic/system.img ./system_rootfs/
          mkfs.erofs -zlz4 ./out/target/product/generic/vendor.img ./vendor_rootfs/
          mkfs.erofs -zlz4hc,9 ./out/target/product/generic/product.img ./product_rootfs/

      - name: Compile Unified Dynamic Super Partition Layout (lpmake)
        run: |
          lpmake \\
            --metadata-size 65536 \\
            --metadata-slots 2 \\
            --device super:4294967296 \\
            --group android_dynamic_group:4294967296 \\
            --partition system:readonly:1572864000:android_dynamic_group \\
            --image system=./out/target/product/generic/system.img \\
            --partition vendor:readonly:629145600:android_dynamic_group \\
            --image vendor=./out/target/product/generic/vendor.img \\
            --partition product:readonly:629145600:android_dynamic_group \\
            --image product=./out/target/product/generic/product.img \\
            --output ./out/target/product/generic/super.img

      - name: Verify Dynamic Image Integrity
        run: |
          fsck.erofs --superblock ./out/target/product/generic/system.img
          echo "All dynamic sectors are structurally aligned. DM-Verity keys signed."

      - name: Archive Compiled Customized ROM Images
        uses: actions/upload-artifact@v4
        with:
          name: aosp-custom-rom-images
          path: |
            ./out/target/product/generic/system.img
            ./out/target/product/generic/vendor.img
            ./out/target/product/generic/product.img
            ./out/target/product/generic/super.img
`;

  // Generating a power profile configuration in YAML format
  const powerProfileYaml = `# Android OS Board Power Profiles Configuration
power_profile:
  device_name: "Pixel Core Generic Board"
  battery_capacity_mah: 4500
  cpu_cores: 8
  power_clusters:
    - cluster_id: 0
      cores: [0, 1, 2, 3]
      nominal_power_ma: 45.2
      deep_sleep_power_ma: 1.5
    - cluster_id: 1
      cores: [4, 5, 6, 7]
      nominal_power_ma: 180.5
      deep_sleep_power_ma: 3.2
  peripheral_power_states:
    color_sensor:
      active_power_ma: 12.0
      standby_power_ma: 0.1
`;

  // Local agent daemon configuration YAML format
  const localAgentConfigYaml = `# Android OS Build Agent Daemon Configuration
agent_id: local-desktop-daem
endpoint_port: 8080
auth_token: "STUDIO_SECURE_TOKEN_556_AOSP"
workspace_dir: "/home/developer/aosp_agent_workspace"

hardware_constraints:
  concurrency_limit: ${agentThreads}
  priority_nice_level: -10
  io_scheduler: "bfq"

compilation_parameters:
  ccache_enabled: ${ccacheEnabled}
  ccache_directory: "/home/developer/.ccache"
  auto_clean_before_build: ${autoCleanBeforeBuild}
  signing_keys: "${signingKeyType}"
  default_target: "super_image"

hooks:
  pre_build_check: "./scripts/pre_flight_checksums.sh"
  post_build_publish: "./scripts/publish_ota_package.sh"
`;

  return (
    <div className="flex flex-col gap-8" id="automation-pipeline-workspace">
      
      {/* HEADER SECTION */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Workflow className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" /> Automated Agent Compiler
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <Workflow className="text-indigo-500 w-7 h-7 animate-pulse" /> Automation & Build Agent Pipelines
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Assemble dynamic OS components, configure local compiling agent daemons, orchestrate remote cloud nodes, or write production-ready GitHub Actions YAML workflows.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePackageWorkspace}
              disabled={isPackaging}
              className="flex items-center gap-2 bg-[#12192c] border border-indigo-500/30 text-indigo-300 hover:text-white px-5 py-3 rounded-xl font-bold text-sm transition-all shadow cursor-pointer"
              id="package-os-workspace-btn"
            >
              {isPackaging ? <RefreshCw className="w-4.5 h-4.5 animate-spin" /> : <Pocket className="w-4.5 h-4.5" />}
              {isPackaging ? "Packaging Assets..." : "Package OS Workspace Bundle"}
            </button>

            <button
              onClick={handleExecutePipeline}
              disabled={isCompiling}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-40 text-white px-5 py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-500/15 cursor-pointer"
              id="trigger-ci-pipeline-btn"
            >
              {isCompiling ? <RefreshCw className="w-4.5 h-4.5 animate-spin" /> : <Play className="w-4.5 h-4.5 fill-white" />}
              {isCompiling ? `Compiling on ${pipelineTarget.toUpperCase()}...` : "Execute Automated Compile Pipeline"}
            </button>
          </div>
        </div>
      </div>

      {/* WORKSPACE BUNDLING REPORT BAR */}
      {packagedFile && (
        <div className="bg-[#111827] border border-blue-500/20 rounded-2xl p-5 shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
              <FileCheck className="w-5.5 h-5.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-white">Workspace Bundle Package Generated Successfully</span>
                <span className="text-[9.5px] font-mono bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-bold uppercase">ZIP EXPORT</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">This bundle packages all your compiled system HALs, SELinux policy files, fuser rules, and partition tools configurations into a unified program.</p>
              
              <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono mt-2">
                <span>File: <strong className="text-slate-300">{packagedFile.filename}</strong></span>
                <span>•</span>
                <span>Size: <strong className="text-slate-300">{packagedFile.size}</strong></span>
                <span>•</span>
                <span>Items: <strong className="text-slate-300">{packagedFile.filesCount} workspace nodes</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowPackageContents(!showPackageContents)}
              className="px-3.5 py-2 bg-slate-950 border border-slate-900 hover:border-slate-800 text-xs font-bold text-slate-400 hover:text-slate-200 rounded-lg transition-all cursor-pointer"
            >
              {showPackageContents ? "Hide Package Tree" : "Inspect Package Contents"}
            </button>
            <a 
              href="#"
              onClick={(e) => { e.preventDefault(); alert("Successfully downloaded compiled OS package bundle!"); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white rounded-lg transition-all shadow cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Download Bundle
            </a>
          </div>
        </div>
      )}

      {/* INSPECT PACKAGE CONTENTS TREE VIEW */}
      {packagedFile && showPackageContents && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3 border-b border-slate-900 pb-2">
            <FolderSync className="w-4 h-4 text-indigo-400" />
            <span className="text-xs uppercase tracking-wider font-bold text-slate-300 font-mono">Packaged Bundle Tree Directory Structure</span>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 font-mono text-xs text-slate-400 space-y-2">
            <div className="text-white font-bold">📦 {packagedFile.filename}</div>
            <div className="pl-4">├── 📂 <span className="text-blue-400 font-bold">system_rootfs/</span> <span className="text-slate-600 text-[10px]">(Standard system mount files)</span></div>
            <div className="pl-4">├── 📂 <span className="text-blue-400 font-bold">vendor_rootfs/</span> <span className="text-slate-600 text-[10px]">(Android HAL services & drivers)</span></div>
            <div className="pl-4">├── 📂 <span className="text-blue-400 font-bold">product_rootfs/</span> <span className="text-slate-600 text-[10px]">(Product apps & branding custom overlays)</span></div>
            <div className="pl-4 font-bold">├── 📂 scripts/</div>
            <div className="pl-8">├── 📄 <span className="text-emerald-400">fuse_rootfs.sh</span> <span className="text-slate-600 text-[10px]">(Fuses base distro filesystems)</span></div>
            <div className="pl-8">├── 📄 <span className="text-emerald-400">lpmake_super.sh</span> <span className="text-slate-600 text-[10px]">(Assembles super.img partitions layout)</span></div>
            <div className="pl-8">├── 📄 <span className="text-emerald-400">mkfs_erofs_all.sh</span> <span className="text-slate-600 text-[10px]">(Packs partitions into read-only EROFS blocks)</span></div>
            <div className="pl-4 font-bold">├── 📂 configuration/</div>
            <div className="pl-8">├── 📄 chroot_init.rc <span className="text-slate-600 text-[10px]">(Android service init triggers)</span></div>
            <div className="pl-8">├── 📄 build_manifest.xml <span className="text-slate-600 text-[10px]">(Platform specifications metadata)</span></div>
            <div className="pl-8">├── 📄 power_profile.{powerFormat.toLowerCase()} <span className="text-slate-600 text-[10px]">(Power management configuration in {powerFormat} format)</span></div>
            <div className="pl-4">└── 📄 README.md <span className="text-slate-600 text-[10px]">(Full automated command guide)</span></div>
          </div>
        </div>
      )}

      {/* PIPELINE EXECUTION PANEL (GUI shows in the Front, Coding is in the background) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* LEFT COLUMN: THE FRONT-END GUI CONTROLLER (Spans 7) */}
        <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">1</span>
                Automation Pipeline Orchestration (GUI in Front)
              </h3>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-900">
                GUI Control Interface
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed mb-5">
              Choose your build agent runtime backend and configure compilation parameters using the graphical sliders and buttons below.
            </p>

            {/* Target Selector row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { id: 'github_actions', label: 'GitHub Actions', desc: 'Cloud Workflow CI/CD', icon: Github },
                { id: 'local_agent', label: 'Local Agent', desc: 'Daemon Workstation', icon: Server },
                { id: 'cloud_agent', label: 'Cloud Remote Agent', desc: 'Remote High-Perf VM', icon: Cpu }
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setPipelineTarget(t.id as any)}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                      pipelineTarget === t.id
                        ? 'bg-indigo-600/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/20'
                        : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-800'
                    }`}
                  >
                    <Icon className="w-5 h-5 text-indigo-400 mb-2" />
                    <span className="block font-bold text-xs">{t.label}</span>
                    <span className="text-[9px] text-slate-500 block mt-0.5">{t.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* Config Sliders & Options */}
            <div className="space-y-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2 font-mono">Graphical Build Tweak Controls</span>

              {/* Toggle cache */}
              <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                <div className="flex items-start gap-2 max-w-[340px]">
                  <Settings2 className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-white block">Enable Compiler Caching (ccache)</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Safely buffers static build stages to accelerate subsequent ROM compilation passes.</span>
                  </div>
                </div>

                <div 
                  onClick={() => setCcacheEnabled(!ccacheEnabled)}
                  className={`w-9 h-5 rounded-full transition-colors cursor-pointer p-0.5 ${ccacheEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${ccacheEnabled ? 'translate-x-4' : ''}`} />
                </div>
              </div>

              {/* ccache slider, only if enabled */}
              {ccacheEnabled && (
                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-900 space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-300">
                    <span>Cache Storage Allocation Limit</span>
                    <span className="text-indigo-400 font-mono">{ccacheSizeGb} GB</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    step="10"
                    value={ccacheSizeGb}
                    onChange={(e) => setCcacheSizeGb(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              )}

              {/* Toggle auto clean */}
              <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                <div className="flex items-start gap-2 max-w-[340px]">
                  <Flame className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-white block">Auto Clean Workspace (make clean)</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Deletes all previous build artifacts prior to executing the compiler. Recommended for final releases.</span>
                  </div>
                </div>

                <div 
                  onClick={() => setAutoCleanBeforeBuild(!autoCleanBeforeBuild)}
                  className={`w-9 h-5 rounded-full transition-colors cursor-pointer p-0.5 ${autoCleanBeforeBuild ? 'bg-indigo-500' : 'bg-slate-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${autoCleanBeforeBuild ? 'translate-x-4' : ''}`} />
                </div>
              </div>

              {/* Signing Keys selector */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">AOSP Security Keys / Signatures Mode</label>
                <div className="relative">
                  <select
                    value={signingKeyType}
                    onChange={(e) => setSigningKeyType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 hover:border-slate-850 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none appearance-none font-mono"
                  >
                    <option value="test-keys">Test Keys (Standard local recovery flashing - Dev mode)</option>
                    <option value="release-keys">Release Keys (Secured hardware boot, enforces dm-verity bootloader locks)</option>
                    <option value="shared-keys">Shared AOSP System Signature keys (Provides system app shared UID permissions)</option>
                  </select>
                  <ChevronRight className="w-4 h-4 text-slate-500 absolute right-3 top-3 rotate-90 pointer-events-none" />
                </div>
              </div>

              {/* Power Profile format select */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">Power Profile Configuration Format</label>
                <div className="relative">
                  <select
                    value={powerFormat}
                    onChange={(e) => setPowerFormat(e.target.value as 'YML' | 'YAML')}
                    className="w-full bg-slate-950 border border-slate-900 hover:border-slate-850 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none appearance-none font-mono"
                  >
                    <option value="YML">YML Format (.yml)</option>
                    <option value="YAML">YAML Format (.yaml)</option>
                  </select>
                  <ChevronRight className="w-4 h-4 text-slate-500 absolute right-3 top-3 rotate-90 pointer-events-none" />
                </div>
              </div>

            </div>
          </div>

          {/* ACTIVE BUILD PROGRESS BAR */}
          {isCompiling && (
            <div className="mt-5 p-4 bg-indigo-500/5 rounded-xl border border-indigo-500/20 space-y-2 animate-pulse">
              <div className="flex justify-between items-center text-xs font-bold font-mono">
                <span className="text-indigo-300">Assembling image assets...</span>
                <span className="text-indigo-400">{pipelineProgress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${pipelineProgress}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: THE COMPILER LOGS BACKGROUND (Spans 5) */}
        <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div className="flex-1 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                  <Terminal className="w-4 h-4 text-indigo-400" /> Pipeline compiling log (Background)
                </h3>
                <span className="text-[10px] font-mono text-slate-500">
                  Daemon Shell
                </span>
              </div>
              
              <p className="text-xs text-slate-400 mb-4">
                Watch the background code compilation in real-time as your custom AOSP modules, EROFS systems, and build parameters are fused together.
              </p>
            </div>

            {/* Dynamic log display terminal */}
            <div className="bg-[#050811] p-4 rounded-xl border border-slate-900 font-mono text-[10.5px] leading-relaxed text-slate-400 h-[340px] overflow-y-auto space-y-1.5 scrollbar-thin">
              {pipelineLogs.length > 0 ? (
                pipelineLogs.map((log, index) => (
                  <div key={index} className="truncate">
                    <span className={`${log.startsWith('[SUCCESS]') ? 'text-emerald-400' : 'text-indigo-400'}`}>CI_PIPELINE:~$</span> {log}
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center">
                  <Terminal className="w-12 h-12 text-slate-800 mb-2" />
                  <span>Pipeline log stream is idle.</span>
                  <span className="text-[9.5px] mt-1 text-slate-700">Click "Execute Automated Compile Pipeline" to start.</span>
                </div>
              )}
            </div>

            {/* Quick stats footer */}
            <div className="pt-3 border-t border-slate-900 text-[10px] text-slate-500 font-mono flex justify-between mt-3">
              <span>Runner status: <span className="text-emerald-400 font-bold">ONLINE</span></span>
              <span>Workspace Files Staged: {workspaceFiles.length || 5}</span>
            </div>
          </div>
        </div>

      </div>

      {/* DETAILED WORKFLOW & AGENT CONFIGURING SCRIPTS (GUI shows in the Front, Coding is in the background) */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-900 pb-3 mb-4 gap-3">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Workflow className="w-4.5 h-4.5 text-indigo-400" /> CI/CD Automation Workflows & Configs (Background Coding)
            </h3>
            <span className="text-xs text-slate-400 block mt-0.5">Synthesizes automation configuration structures based on your visual layout selections.</span>
          </div>

          <div className="flex bg-slate-950 border border-slate-900 rounded-lg p-0.5">
            <button
              onClick={() => setActiveWorkflowTab('github')}
              className={`px-3 py-1.5 rounded-md text-[10.5px] font-mono whitespace-nowrap cursor-pointer transition-all ${
                activeWorkflowTab === 'github'
                  ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              GitHub Actions YAML
            </button>
            <button
              onClick={() => setActiveWorkflowTab('local_agent_config')}
              className={`px-3 py-1.5 rounded-md text-[10.5px] font-mono whitespace-nowrap cursor-pointer transition-all ${
                activeWorkflowTab === 'local_agent_config'
                  ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Agent Daemon Config
            </button>
            <button
              onClick={() => setActiveWorkflowTab('power_config')}
              className={`px-3 py-1.5 rounded-md text-[10.5px] font-mono whitespace-nowrap cursor-pointer transition-all ${
                activeWorkflowTab === 'power_config'
                  ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Power Profile {powerFormat}
            </button>
            <button
              onClick={() => setActiveWorkflowTab('readme')}
              className={`px-3 py-1.5 rounded-md text-[10.5px] font-mono whitespace-nowrap cursor-pointer transition-all ${
                activeWorkflowTab === 'readme'
                  ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Automated Setup Readme
            </button>
          </div>
        </div>

        {/* Display panel */}
        <div className="space-y-4">
          <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
            <span>File Path: {
              activeWorkflowTab === 'github' 
                ? '.github/workflows/aosp_build.yml' 
                : activeWorkflowTab === 'local_agent_config' 
                  ? 'agent_daemon_config.yml' 
                  : activeWorkflowTab === 'power_config'
                    ? `power_profile.${powerFormat.toLowerCase()}`
                    : 'AUTOMATED_BUILD_GUIDE.md'
            }</span>
            
            <button
              onClick={() => copyToClipboard(
                activeWorkflowTab === 'github' 
                  ? githubActionsWorkflow 
                  : activeWorkflowTab === 'local_agent_config' 
                    ? localAgentConfigYaml 
                    : activeWorkflowTab === 'power_config'
                      ? powerProfileYaml
                      : `# AOSP Automated OS Builder Guide\n\n1. Install build agent.\n2. Configure keys.\n3. Run ./fuse_rootfs.sh`
              )}
              className="px-2.5 py-1 bg-slate-950 hover:bg-slate-900 border border-slate-900 hover:border-slate-850 text-slate-400 hover:text-white rounded transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3 h-3" /> {copyFeedback || 'Copy Configuration'}
            </button>
          </div>

          <textarea
            readOnly
            className="w-full bg-slate-950 text-indigo-300 font-mono text-[10.5px] leading-relaxed resize-none p-4 rounded-xl border border-slate-900 h-[320px] focus:outline-none"
            value={
              activeWorkflowTab === 'github' 
                ? githubActionsWorkflow 
                : activeWorkflowTab === 'local_agent_config' 
                  ? localAgentConfigYaml 
                  : activeWorkflowTab === 'power_config'
                    ? powerProfileYaml
                    : `# AOSP Dynamic Partition Compiler & Build Guide

This automated setup packages all your graphical fuser layouts and EROFS dynamic partitions into a portable, executable compiler bundle.

## System Prerequisites
Ensure your local or cloud target compiling environment has the standard dynamic partition utensils installed:
\`\`\`bash
# Install dynamic partition table build tools & EROFS compressors
sudo apt-get update
sudo apt-get install -y android-sdk-libutils EROFS-utils gcc-aarch64-linux-gnu ccache
\`\`\`

## Automated Compiling Execution
To run the packaging and flashable super.img assembler dynamically in one sweep:
\`\`\`bash
# 1. Extract package bundle
unzip aosp_custom_workspace_bundle.zip -d ./custom_aosp_tree/
cd ./custom_aosp_tree/

# 2. Execute fuser directories merging
chmod +x ./scripts/fuse_rootfs.sh
./scripts/fuse_rootfs.sh

# 3. Assemble dynamic partitions & pack images
chmod +x ./scripts/lpmake_super.sh
./scripts/lpmake_super.sh
\`\`\`

This outputs a flashable \`super.img\` in your build workspace directory under \`./out/target/product/generic/\` which can be flashed over fastboot to physical targets.`
            }
          />
        </div>
      </div>

      {/* REGISTER CUSTOM BUILD AGENTS SECTION */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Import className="text-indigo-400 w-4.5 h-4.5" /> Import Local or Cloud Compile Agents
        </h3>
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Link your own remote cloud compile instances or local daemon scripts. Doing so allows the builder to securely communicate and dispatch real shell compiling transactions in the background.
        </p>

        {/* Existing active agents */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {agents.map((a) => (
            <div 
              key={a.id} 
              className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/5 border border-indigo-500/15 flex items-center justify-center text-indigo-400">
                  {a.type === 'local' ? <Server className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-white">{a.name}</span>
                    <span className="px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 text-[8.5px] font-bold rounded uppercase">
                      {a.status}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 block font-mono mt-0.5">{a.endpoint}</span>
                  
                  <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-500 font-mono">
                    <span>{a.architecture}</span>
                    <span>•</span>
                    <span>{a.threads} core compiler</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleDeleteAgent(a.id)}
                className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/5 transition-colors cursor-pointer"
                title="Deregister compiler node"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Agent Registration Form */}
        <div className="pt-4 border-t border-slate-900">
          <span className="text-xs font-bold text-white uppercase block mb-3 font-mono">Register Build Node Credentials</span>
          
          <form onSubmit={handleAddAgent} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Agent / Host Name</label>
              <input
                type="text"
                required
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. AWS C6i Compiler"
                className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Daemon Endpoint API Link</label>
              <input
                type="text"
                required
                value={agentEndpoint}
                onChange={(e) => setAgentEndpoint(e.target.value)}
                placeholder="e.g. http://192.168.1.150:8080"
                className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Hardware Core Threads</label>
              <input
                type="number"
                required
                min={1}
                value={agentThreads}
                onChange={(e) => setAgentThreads(parseInt(e.target.value) || 4)}
                className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Build Node Network Type</label>
              <select
                value={agentType}
                onChange={(e) => setAgentType(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="local">Local Host Network (Loopback / LAN)</option>
                <option value="cloud">Cloud Virtual Instance (AWS/GCP/SSH)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Daemon CPU Architecture</label>
              <select
                value={agentArch}
                onChange={(e) => setAgentArch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ARM64 (aarch64)">ARM64 Native (Ampere / Apple Silicon)</option>
                <option value="x86_64 (Intel Xeon / AMD EPYC)">x86_64 Server (Linux / Ubuntu)</option>
                <option value="RISC-V (rv64imafd)">RISC-V Developer Board</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-xs transition-all shadow cursor-pointer flex items-center justify-center gap-2 h-[36px]"
              >
                <Plus className="w-4 h-4" /> Connect Compiler Node
              </button>
            </div>
          </form>
        </div>
      </div>

    </div>
  );
}
