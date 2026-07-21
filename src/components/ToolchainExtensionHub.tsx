/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Wrench, 
  Terminal, 
  Settings, 
  Cpu, 
  Layers, 
  Hammer, 
  Play, 
  Download, 
  Info, 
  Check, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Plus, 
  Trash2, 
  RefreshCw, 
  FileCode, 
  Package, 
  Code, 
  FileText, 
  Activity, 
  Boxes, 
  Link,
  ChevronRight,
  ShieldCheck,
  Zap,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ToolchainExtension {
  id: string;
  name: string;
  identifier: string;
  version: string;
  category: 'compiler' | 'utility' | 'firmware' | 'security';
  status: 'active' | 'standby' | 'compiling' | 'conflict';
  arch: 'arm64' | 'x86_64' | 'universal' | 'riscv64';
  sizeBytes: number;
  description: string;
  binaries: string[];
  dependencies: string[];
  author: string;
}

interface ExtensionFile {
  name: string;
  path: string;
  content: string;
  language: 'c' | 'makefile' | 'json' | 'shell';
}

export default function ToolchainExtensionHub() {
  // Pre-loaded standalone binary extensions inside ROM kitchen
  const [extensions, setExtensions] = useState<ToolchainExtension[]>([
    {
      id: 'llvm-arm64',
      name: 'GNU LLVM / Clang Arm64 Cross-Toolchain',
      identifier: 'realm.toolchain.llvm_arm64',
      version: '17.0.6',
      category: 'compiler',
      status: 'active',
      arch: 'arm64',
      sizeBytes: 184549376, // ~176 MB
      description: 'Cross-compiler toolchain containing Clang, LLD, and LLVM binaries optimized for direct kernel GKI/AOSP compilation.',
      binaries: ['aarch64-linux-gnu-clang', 'aarch64-linux-gnu-ld', 'llvm-objdump', 'llvm-strip'],
      dependencies: ['libc6-dev', 'libssl-dev'],
      author: 'GNU Core Maintainers'
    },
    {
      id: 'rust-android',
      name: 'Rust Android Toolchain (GKI-Ready)',
      identifier: 'realm.toolchain.rust_android',
      version: '1.78.0',
      category: 'compiler',
      status: 'active',
      arch: 'arm64',
      sizeBytes: 294120394, // ~280 MB
      description: 'Statically optimized Rust compiler backend with target registry configured for aarch64-linux-android userspace system daemons.',
      binaries: ['rustc-android', 'cargo-android', 'bindgen-gki'],
      dependencies: ['llvm-arm64'],
      author: 'Mozilla Rust Android SIG'
    },
    {
      id: 'busybox-static',
      name: 'BusyBox Multi-call Static Utilities Pack',
      identifier: 'realm.utility.busybox_static',
      version: '1.36.1',
      category: 'utility',
      status: 'active',
      arch: 'universal',
      sizeBytes: 1245902, // 1.2 MB
      description: 'Combines tiny versions of over 300 common UNIX utilities into a single, statically linked binary. Resolves missing system userland binaries.',
      binaries: ['busybox', 'busybox-sed', 'busybox-awk', 'busybox-grep'],
      dependencies: [],
      author: 'Denys Vlasenko & Contributors'
    },
    {
      id: 'android-image-kitchen-bin',
      name: 'AIK-Linux Low-level Ramdisk binaries',
      identifier: 'realm.utility.aik_binaries',
      version: '3.8.0',
      category: 'firmware',
      status: 'active',
      arch: 'x86_64',
      sizeBytes: 4194304, // 4MB
      description: 'Low-latency native binaries including mkbootimg, unpackbootimg, and minigzip for parsing, decompiling, and modifying boot/recovery partitions.',
      binaries: ['unpackbootimg', 'mkbootimg', 'minigzip-static'],
      dependencies: ['busybox-static'],
      author: 'osm0sis'
    },
    {
      id: 'grub-ventoy-compiler',
      name: 'Ventoy Hybrid EFI Bootloader Compiler',
      identifier: 'realm.firmware.ventoy_grub',
      version: '1.0.99',
      category: 'firmware',
      status: 'active',
      arch: 'universal',
      sizeBytes: 45097152, // 43 MB
      description: 'Generates ISO9660 hybrid boot blocks containing custom Grub EFI loader layers, allowing Ventoy to seamlessly chainload AnyRealm appliance live-boots.',
      binaries: ['grub-mkimage', 'xorrisofs', 'mkisofs-realm'],
      dependencies: ['llvm-arm64'],
      author: 'Ventoy Community & Realm Devs'
    },
    {
      id: 'magiskpolicy-sepolicy',
      name: 'magiskpolicy SELinux Rule Compiler',
      identifier: 'realm.security.magiskpolicy',
      version: '27.0',
      category: 'security',
      status: 'standby',
      arch: 'arm64',
      sizeBytes: 850392, // ~830 KB
      description: 'Pre-compiled security engine standalone utility used to inject direct permissive/enforced security context transitions into binary sepolicy rules.',
      binaries: ['magiskpolicy', 'sepolicy-inject'],
      dependencies: [],
      author: 'topjohnwu'
    }
  ]);

  // Selected toolchain extension for details panel
  const [selectedExt, setSelectedExt] = useState<ToolchainExtension>(extensions[0]);

  // Tab views within the Hub
  const [activeSubTab, setActiveSubTab] = useState<'installed' | 'builder' | 'sandbox'>('installed');

  // New custom extension files state (pre-populated with templates for immediate high-fidelity play)
  const [builderFiles, setBuilderFiles] = useState<ExtensionFile[]>([
    {
      name: 'main.c',
      path: 'src/main.c',
      language: 'c',
      content: `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\nint main(int argc, char *argv[]) {\n    printf("==========================================\\n");\n    printf("   ANYREALM CUSTOM EXTENSION RUNTIME v1.0  \\n");\n    printf("==========================================\\n");\n    \n    if (argc < 2) {\n        printf("Usage: %s [run-test | --version | --help]\\n", argv[0]);\n        return 1;\n    }\n    \n    if (strcmp(argv[1], "--version") == 0) {\n        printf("AnyRealm Extension Binary v1.0.0-beta\\n");\n        printf("Compiled for Architecture: ARM64-AOSP\\n");\n        return 0;\n    }\n    \n    if (strcmp(argv[1], "run-test") == 0) {\n        printf("[*] Starting diagnostic test routine...\\n");\n        printf("[OK] Hardware interface hook verified.\\n");\n        printf("[OK] Secure storage persistent mount detected.\\n");\n        printf("[SUCCESS] All extension diagnostics passed green!\\n");\n        return 0;\n    }\n    \n    printf("Error: Unknown parameter '%s'\\n", argv[1]);\n    return 1;\n}`
    },
    {
      name: 'Makefile',
      path: 'Makefile',
      language: 'makefile',
      content: `CC = aarch64-linux-gnu-gcc\nCFLAGS = -O3 -Wall -static\nTARGET = out/bin/realm_custom_tool\n\nall: clean\n\tmkdir -p out/bin\n\t$(CC) $(CFLAGS) src/main.c -o $(TARGET)\n\nclean:\n\trm -rf out/`
    },
    {
      name: 'extension_manifest.json',
      path: 'extension_manifest.json',
      language: 'json',
      content: `{\n  "name": "Custom Hardware Diagnostic Tool",\n  "identifier": "realm.custom.hw_diag",\n  "version": "1.0.0",\n  "category": "utility",\n  "arch": "arm64",\n  "binaries": [\n    "realm_custom_tool"\n  ],\n  "dependencies": [\n    "busybox-static"\n  ],\n  "description": "Custom compiled ARM64 static diagnostic toolchain extension for injecting physical sensory board bypass commands."\n}`
    }
  ]);

  const [selectedBuilderFile, setSelectedBuilderFile] = useState<ExtensionFile>(builderFiles[0]);
  const [editorContent, setEditorContent] = useState<string>(builderFiles[0].content);

  // New extension meta parameters
  const [newExtName, setNewExtName] = useState('Custom Hardware Diagnostic Tool');
  const [newExtArch, setNewExtArch] = useState<'arm64' | 'x86_64' | 'riscv64'>('arm64');
  const [newExtCategory, setNewExtCategory] = useState<'compiler' | 'utility' | 'firmware' | 'security'>('utility');

  // Build simulator logs and states
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildSuccess, setBuildSuccess] = useState<boolean | null>(null);

  // Sandbox Command Execution States
  const [sandboxSelectedTool, setSandboxSelectedTool] = useState<string>('busybox-static');
  const [sandboxArgs, setSandboxArgs] = useState('run-test');
  const [sandboxLogs, setSandboxLogs] = useState<string[]>([
    '[*] Isolated Toolchain Sandbox Console initialized.',
    '[*] Select a binary extension above and enter arguments to simulate container execution.'
  ]);
  const [isExecutingSandbox, setIsExecutingSandbox] = useState(false);

  // Export companion modal
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedFilename, setExportedFilename] = useState('');

  // Handle active file change inside builder editor
  const handleSelectBuilderFile = (file: ExtensionFile) => {
    // Save current file edits first
    setBuilderFiles(prev => prev.map(f => f.path === selectedBuilderFile.path ? { ...f, content: editorContent } : f));
    setSelectedBuilderFile(file);
    setEditorContent(file.content);
  };

  // Sync state if user types in editor
  useEffect(() => {
    setBuilderFiles(prev => prev.map(f => f.path === selectedBuilderFile.path ? { ...f, content: editorContent } : f));
  }, [editorContent]);

  // Simulated extension compilation sequence
  const handleCompileExtension = () => {
    if (isBuilding) return;
    setIsBuilding(true);
    setBuildLogs([]);
    setBuildSuccess(null);

    const steps = [
      `[*] Initializing AnyRealm Compiler toolchain core daemon...`,
      `[*] Parsing extension_manifest.json verification blocks...`,
      `    -> Name: "${newExtName}"`,
      `    -> Category: "${newExtCategory}"`,
      `    -> Architecture Target: "${newExtArch}"`,
      `[*] Mapping virtual workspace directories: /workspace/src`,
      `[*] Validating dependencies... Checked: "busybox-static" is LOADED in workspace environment.`,
      `[*] Loading workspace Makefile parameters...`,
      `[*] Spawning build environment. Executing make target: 'all'`,
      `    $ ${newExtArch === 'arm64' ? 'aarch64-linux-gnu-gcc' : newExtArch === 'riscv64' ? 'riscv64-linux-gnu-gcc' : 'x86_64-linux-gnu-gcc'} -O3 -Wall -static src/main.c -o out/bin/realm_custom_tool`,
      `[*] Compiling /workspace/src/main.c AST trees...`,
      `[*] Running optimization matrices: -O3 loop-unrolling, dead-code-elimination, constant folding.`,
      `[*] Linker phase starting: generating standalone ELF executable binary...`,
      `[*] Static link analysis: resolving external glibc static references into static frame.`,
      `[*] Executing symbols strip: 'llvm-strip --strip-debug out/bin/realm_custom_tool'`,
      `[*] Analyzing compiled ELF headers...`,
      `    -> Format: ELF 64-bit LSB executable, ${newExtArch === 'arm64' ? 'ARM aarch64' : newExtArch === 'riscv64' ? 'UC-RISCV' : 'x86-64'}, statically linked`,
      `    -> Size: 142.8 KB (Optimized dynamic allocation overlay active)`,
      `[SUCCESS] Binary successfully compiled: out/bin/realm_custom_tool`,
      `[SUCCESS] Packing standalone overlay: realm.custom.hw_diag.realm_ext.tar.gz`,
      `[SUCCESS] Registered custom toolchain extension successfully into active RAM OS environment.`
    ];

    steps.forEach((step, index) => {
      setTimeout(() => {
        setBuildLogs(prev => [...prev, step]);
        if (index === steps.length - 1) {
          setIsBuilding(false);
          setBuildSuccess(true);
          
          // Add the newly compiled extension to the list dynamically!
          const newExt: ToolchainExtension = {
            id: 'custom-hw-diag',
            name: newExtName,
            identifier: 'realm.custom.hw_diag',
            version: '1.0.0',
            category: newExtCategory,
            status: 'active',
            arch: newExtArch,
            sizeBytes: 146227, // ~142 KB
            description: 'Custom compiled static binary toolchain extension created dynamically inside the IDE builder workspace.',
            binaries: ['realm_custom_tool'],
            dependencies: ['busybox-static'],
            author: 'Local Workspace Developer'
          };

          setExtensions(prev => {
            // Remove existing if duplicate
            const filtered = prev.filter(e => e.id !== 'custom-hw-diag');
            return [...filtered, newExt];
          });
          setSelectedExt(newExt);
        }
      }, (index + 1) * 300);
    });
  };

  // Simulated CLI Sandbox Execution sequence
  const handleExecuteSandbox = () => {
    if (isExecutingSandbox) return;
    setIsExecutingSandbox(true);
    
    const selectedExtObj = extensions.find(e => e.id === sandboxSelectedTool);
    if (!selectedExtObj) {
      setSandboxLogs(prev => [...prev, `[ERROR] Selected tool not found.`]);
      setIsExecutingSandbox(false);
      return;
    }

    const commandLine = `$ ${selectedExtObj.binaries[0]} ${sandboxArgs}`;
    setSandboxLogs(prev => [...prev, commandLine, `[*] Spawning container sandbox overlay namespace...`]);

    setTimeout(() => {
      let runSteps: string[] = [];

      if (selectedExtObj.id === 'busybox-static') {
        if (sandboxArgs.includes('run-test') || sandboxArgs.includes('test')) {
          runSteps = [
            `busybox v1.36.1 (2026-03-12 11:42:01 UTC) multi-call binary.`,
            `[OK] Executing isolated sandbox tests.`,
            `[OK] Standard POSIX coreutils mappings checked (echo, cat, grep, sed, awk).`,
            `[OK] Local loops return exit code 0. Environment fully secure.`
          ];
        } else if (sandboxArgs.includes('--help') || sandboxArgs.includes('-h')) {
          runSteps = [
            `BusyBox is a multi-call binary that combines many common Unix utilities.`,
            `Usage: busybox [function [arguments]...]`,
            `   or: function [arguments]...`,
            `Currently defined functions:`,
            `   awk, cat, chmod, chown, cp, cut, dd, df, echo, egrep, fgrep, grep, gzip,`,
            `   head, id, kill, ln, ls, mkdir, mv, ps, pwd, rm, rmdir, sed, tar, touch`
          ];
        } else {
          runSteps = [
            `[BUSYBOX] command execution successful. stdout piped below:`,
            `BusyBox utility mock executed: '${sandboxArgs}'. Exit code: 0.`
          ];
        }
      } else if (selectedExtObj.id === 'llvm-arm64') {
        runSteps = [
          `aarch64-linux-gnu-clang version 17.0.6`,
          `Target: aarch64-unknown-linux-gnu`,
          `Thread model: posix`,
          `InstalledDir: /usr/local/anyrealm/toolchain/llvm-arm64/bin`,
          `[FATAL] No input files specified. Clang compilation halted.`
        ];
      } else if (selectedExtObj.id === 'custom-hw-diag') {
        if (sandboxArgs === 'run-test') {
          runSteps = [
            `==========================================`,
            `   ANYREALM CUSTOM EXTENSION RUNTIME v1.0  `,
            `==========================================`,
            `[*] Starting diagnostic test routine...`,
            `[OK] Hardware interface hook verified.`,
            `[OK] Secure storage persistent mount detected.`,
            `[SUCCESS] All extension diagnostics passed green!`,
            `[EXIT STATUS] 0`
          ];
        } else if (sandboxArgs === '--version') {
          runSteps = [
            `==========================================`,
            `   ANYREALM CUSTOM EXTENSION RUNTIME v1.0  `,
            `==========================================`,
            `AnyRealm Extension Binary v1.0.0-beta`,
            `Compiled for Architecture: ARM64-AOSP`,
            `[EXIT STATUS] 0`
          ];
        } else {
          runSteps = [
            `==========================================`,
            `   ANYREALM CUSTOM EXTENSION RUNTIME v1.0  `,
            `==========================================`,
            `Usage: realm_custom_tool [run-test | --version | --help]`,
            `[EXIT STATUS] 1`
          ];
        }
      } else if (selectedExtObj.id === 'android-image-kitchen-bin') {
        runSteps = [
          `Android Image Kitchen - UnpackBootimg Binary v3.8`,
          `[ERROR] Target boot image file not passed in parameters.`,
          `Usage: unpackbootimg -i <boot.img> [-o <output_directory>]`,
          `[EXIT STATUS] 1`
        ];
      } else {
        runSteps = [
          `[DAEMON] Spawning active standalone environment binary: ${selectedExtObj.binaries[0]}`,
          `[INFO] Target binary architecture: ${selectedExtObj.arch}`,
          `[SUCCESS] Execution finished successfully with exit status 0.`
        ];
      }

      setSandboxLogs(prev => [...prev, ...runSteps]);
      setIsExecutingSandbox(false);
    }, 1200);
  };

  // Simulated bundling/export sequence
  const handleExportExtension = () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportProgress(0);
    const filename = `${selectedExt.identifier}-${selectedExt.version}.vsix`;
    setExportedFilename(filename);

    const interval = setInterval(() => {
      setExportProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          
          // Trigger mock file download for user satisfaction
          setTimeout(() => {
            const element = document.createElement("a");
            const file = new Blob([JSON.stringify({
              extension_package: selectedExt.identifier,
              version: selectedExt.version,
              compiled_binaries: selectedExt.binaries,
              arch: selectedExt.arch,
              manifest: selectedExt
            }, null, 2)], { type: 'application/octet-stream' });
            element.href = URL.createObjectURL(file);
            element.download = filename;
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);
            setIsExporting(false);
          }, 600);
          return 100;
        }
        return prev + 10;
      });
    }, 150);
  };

  // Convert bytes to human readable format
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="bg-[#0b0f19] border border-[#1e293b]/70 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full" id="toolchain-extension-hub-root">
      
      {/* Tab Banner / Panel Title */}
      <div className="bg-[#0e1424] border-b border-[#1e293b]/80 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
            <Boxes className="text-indigo-400 w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
              Standalone Toolchain & Extensions Hub
              <span className="text-[9px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-bold uppercase tracking-wider">PRE-ARMED DAEMONS</span>
            </h2>
            <p className="text-[11px] text-slate-400">Pack missing OS build binaries, compile standalone diagnostic plugins, or bundle cross-compilers into standard VS Code addons.</p>
          </div>
        </div>

        {/* Nested Nav Tabs */}
        <div className="flex bg-slate-950 p-1 rounded-md border border-slate-900 gap-1 shrink-0 self-start sm:self-center">
          <button
            onClick={() => setActiveSubTab('installed')}
            className={`px-3 py-1 text-[11px] font-bold rounded cursor-pointer transition-all ${activeSubTab === 'installed' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Active Toolchains
          </button>
          <button
            onClick={() => setActiveSubTab('builder')}
            className={`px-3 py-1 text-[11px] font-bold rounded cursor-pointer transition-all ${activeSubTab === 'builder' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20' : 'text-slate-400 hover:text-slate-200'}`}
          >
            🧩 Build Custom Extension
          </button>
          <button
            onClick={() => setActiveSubTab('sandbox')}
            className={`px-3 py-1 text-[11px] font-bold rounded cursor-pointer transition-all ${activeSubTab === 'sandbox' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20' : 'text-slate-400 hover:text-slate-200'}`}
          >
            📟 Sandbox Terminal
          </button>
        </div>
      </div>

      {/* Main Body Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 min-h-[580px]">
        
        {/* SUBTAB 1: INSTALLED / CORE TOOLCHAINS LIST */}
        {activeSubTab === 'installed' && (
          <>
            {/* Left Column: Extensions Registry */}
            <div className="lg:col-span-5 border-r border-[#1e293b]/50 p-4 bg-slate-950/20 flex flex-col justify-between h-full">
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Active Core Library ({extensions.length})</span>
                  <span className="text-[10px] text-indigo-400 font-mono">AnyRealm Environment Active</span>
                </div>

                <div className="space-y-2 max-h-[460px] overflow-y-auto scrollbar-thin pr-1">
                  {extensions.map((ext) => (
                    <div
                      key={ext.id}
                      onClick={() => setSelectedExt(ext)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedExt.id === ext.id
                          ? 'bg-indigo-950/20 border-indigo-500/40 shadow-md shadow-indigo-950/30'
                          : 'bg-slate-900/40 border-slate-900/60 hover:bg-slate-900/60 hover:border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${ext.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
                          <h3 className="text-xs font-bold text-slate-200 truncate max-w-[170px]">{ext.name}</h3>
                        </div>
                        <span className="text-[9.5px] font-mono text-slate-500">v{ext.version}</span>
                      </div>
                      
                      <p className="text-[10.5px] text-slate-400 line-clamp-2 leading-relaxed mb-2.5">
                        {ext.description}
                      </p>

                      <div className="flex items-center justify-between text-[9px] font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-900 text-slate-400 uppercase font-bold tracking-wider">
                          {ext.arch}
                        </span>
                        <span className="text-slate-500">
                          {formatBytes(ext.sizeBytes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Banner notification about extensions adding binaries */}
              <div className="p-3 bg-indigo-950/15 border border-indigo-900/30 rounded-lg text-[10.5px] text-indigo-300 leading-relaxed mt-4">
                <Info className="w-4 h-4 text-indigo-400 inline mr-1.5 -mt-0.5 shrink-0" />
                <span><strong>Dual-System Tip:</strong> Standalone extensions provide pre-compiled cross-binaries to our <code>Rootfs Fuser</code>, bypassing host container limitations. You can build new missing extensions directly on the adjacent tab.</span>
              </div>
            </div>

            {/* Right Column: Detailed View & Action Suite */}
            <div className="lg:col-span-7 p-6 flex flex-col justify-between bg-slate-950/40">
              {selectedExt ? (
                <div className="flex-1 flex flex-col justify-between gap-6">
                  <div className="space-y-5">
                    {/* Title Header block */}
                    <div className="border-b border-slate-900 pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${selectedExt.category === 'compiler' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : selectedExt.category === 'firmware' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : selectedExt.category === 'security' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                          {selectedExt.category}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">ID: {selectedExt.identifier}</span>
                      </div>
                      <h3 className="text-base font-extrabold text-white">{selectedExt.name}</h3>
                      <p className="text-[11px] text-slate-400 mt-1">Authored by <span className="text-slate-300 font-semibold">{selectedExt.author}</span></p>
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-2.5 bg-slate-950 rounded border border-slate-900/60">
                        <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider">Arch Target</span>
                        <span className="text-xs font-mono font-bold text-slate-200 uppercase">{selectedExt.arch}</span>
                      </div>
                      <div className="p-2.5 bg-slate-950 rounded border border-slate-900/60">
                        <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider">Storage Cost</span>
                        <span className="text-xs font-mono font-bold text-slate-200">{formatBytes(selectedExt.sizeBytes)}</span>
                      </div>
                      <div className="p-2.5 bg-slate-950 rounded border border-slate-900/60">
                        <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider">Binary Status</span>
                        <span className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          LOADED
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-950 rounded border border-slate-900/60">
                        <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider">Target Version</span>
                        <span className="text-xs font-mono font-bold text-slate-200">v{selectedExt.version}</span>
                      </div>
                    </div>

                    {/* Packaged Binary Executables Registry */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest pl-0.5">EXPOSED COMMAND BINARIES ({selectedExt.binaries.length})</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {selectedExt.binaries.map((bin) => (
                          <div key={bin} className="flex items-center justify-between p-2.5 bg-black/40 rounded border border-slate-900/50 font-mono text-[11px] text-slate-300">
                            <span className="flex items-center gap-2">
                              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                              <code>{bin}</code>
                            </span>
                            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.2 rounded border border-indigo-500/20 uppercase font-bold">ELF-64</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Dependencies and libraries mappings */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest pl-0.5">DEPENDENCY LINKERS & ENGINES</h4>
                      {selectedExt.dependencies.length === 0 ? (
                        <div className="p-2.5 bg-black/20 rounded border border-slate-900/40 text-[10.5px] text-slate-500 italic">
                          Statically linked executable. Zero external run-time dependencies.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {selectedExt.dependencies.map((dep) => (
                            <div key={dep} className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 rounded-full border border-slate-900 font-mono text-[10.5px] text-indigo-300">
                              <Link className="w-3 h-3 text-indigo-400" />
                              {dep}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions footer block */}
                  <div className="pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-[10.5px] text-slate-500">
                      Exporting compilation packages formats them as complete, installable zip packages.
                    </p>

                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => {
                          setSandboxSelectedTool(selectedExt.id);
                          setActiveSubTab('sandbox');
                        }}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Run in Sandbox
                      </button>

                      <button
                        onClick={handleExportExtension}
                        disabled={isExporting}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-lg shadow-emerald-950/20"
                      >
                        {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {isExporting ? `Bundling (${exportProgress}%)` : "Export Extension Package"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <Package className="w-12 h-12 text-slate-700 animate-pulse mb-3" />
                  <p className="text-xs text-slate-500">Select a binary toolchain extension from the registry sidebar to inspect exposed terminal executables.</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* SUBTAB 2: CUSTOM EXTENSION BUILDER */}
        {activeSubTab === 'builder' && (
          <div className="lg:col-span-12 p-6 flex flex-col gap-6">
            
            {/* Split Builder panel */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Parameter configs */}
              <div className="lg:col-span-4 space-y-4">
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 space-y-4">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-indigo-400" />
                    Extension Manifest Metadata
                  </h3>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Extension Display Name</label>
                      <input
                        type="text"
                        value={newExtName}
                        onChange={(e) => setNewExtName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500 transition-all"
                        placeholder="e.g. GDB Static Debugger tool"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Target Arch</label>
                        <select
                          value={newExtArch}
                          onChange={(e) => setNewExtArch(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500 transition-all"
                        >
                          <option value="arm64">ARM64 (aarch64)</option>
                          <option value="x86_64">x86_64</option>
                          <option value="riscv64">RISCV64</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Category</label>
                        <select
                          value={newExtCategory}
                          onChange={(e) => setNewExtCategory(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500 transition-all"
                        >
                          <option value="utility">Utility</option>
                          <option value="compiler">Compiler</option>
                          <option value="firmware">Firmware</option>
                          <option value="security">Security</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleCompileExtension}
                      disabled={isBuilding}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-950/20"
                    >
                      {isBuilding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}
                      {isBuilding ? "Compiling Custom Standalone..." : "🔨 Compile Standalone Extension"}
                    </button>
                  </div>
                </div>

                {/* Simulated workspace files explorer */}
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 space-y-3">
                  <h4 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest pl-0.5">EXTENSION WORKSPACE FILES</h4>
                  <div className="space-y-1.5">
                    {builderFiles.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleSelectBuilderFile(file)}
                        className={`w-full flex items-center justify-between p-2 rounded-lg text-left font-mono text-[11px] transition-all cursor-pointer ${
                          selectedBuilderFile.path === file.path
                            ? 'bg-indigo-600/10 border border-indigo-500/20 text-indigo-300'
                            : 'bg-transparent border border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                          <code>{file.name}</code>
                        </span>
                        <span className="text-[9px] text-slate-600">/{file.path}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Code editor and compiler outputs */}
              <div className="lg:col-span-8 flex flex-col gap-4">
                
                {/* Code editor block */}
                <div className="p-4 bg-slate-950 rounded-xl border border-[#1e293b]/70 flex flex-col h-[280px] justify-between">
                  <div className="flex items-center justify-between border-b border-slate-950 pb-2 mb-2">
                    <span className="text-[10px] font-bold text-slate-400 font-mono">Editing: /{selectedBuilderFile.path}</span>
                    <span className="text-[9px] bg-slate-900 text-indigo-400 border border-slate-800 px-1.5 py-0.5 rounded font-mono uppercase font-bold">{selectedBuilderFile.language}</span>
                  </div>

                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    className="w-full flex-1 bg-transparent text-slate-300 font-mono text-[11px] leading-relaxed resize-none focus:outline-none scrollbar-thin scrollbar-thumb-slate-900 h-full"
                    style={{ tabSize: 4 }}
                    id="custom-extension-editor"
                  />

                  <div className="pt-2 text-[9px] text-slate-500 font-mono text-right border-t border-slate-900/60 mt-2">
                    Save persistent - active workspace synced.
                  </div>
                </div>

                {/* Live Compilation logs */}
                <div className="bg-slate-950 rounded-xl border border-slate-900 overflow-hidden flex flex-col">
                  <div className="bg-[#0e1424] px-4 py-2 border-b border-slate-900 flex items-center justify-between">
                    <span className="text-[9.5px] font-bold text-slate-400 uppercase tracking-wider">LIVE COMPILER OVERLAY PROCESS</span>
                    {buildSuccess && (
                      <span className="text-[9.5px] text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> COMPILED SUCCESSFULLY
                      </span>
                    )}
                  </div>
                  
                  <div className="p-3 bg-black/60 font-mono text-[9.5px] text-slate-300 h-[120px] overflow-y-auto space-y-1 scrollbar-thin">
                    {buildLogs.length === 0 ? (
                      <div className="text-slate-500 italic text-center pt-8">
                        No active compilation log. Click 'Compile Standalone Extension' on the left to invoke GC/LLVM compiler.
                      </div>
                    ) : (
                      buildLogs.map((log, index) => (
                        <div key={index} className={`truncate ${log.startsWith('[SUCCESS]') || log.includes('successfully') ? 'text-emerald-400 font-bold' : log.includes('ERROR') ? 'text-red-400' : log.startsWith('    $') ? 'text-blue-400' : 'text-slate-300'}`}>
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* SUBTAB 3: BINARY SANDBOX TERMINAL */}
        {activeSubTab === 'sandbox' && (
          <div className="lg:col-span-12 p-6 flex flex-col gap-6 bg-slate-950/20">
            
            {/* Input params */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Select Tool Binary Source</label>
                  <select
                    value={sandboxSelectedTool}
                    onChange={(e) => setSandboxSelectedTool(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 transition-all"
                  >
                    {extensions.map(ext => (
                      <option key={ext.id} value={ext.id}>
                        {ext.name} (Arch: {ext.arch}, Bin: {ext.binaries[0]})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Command Arguments / Parameters</label>
                  <input
                    type="text"
                    value={sandboxArgs}
                    onChange={(e) => setSandboxArgs(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 transition-all"
                    placeholder="e.g. run-test, --version, --help"
                  />
                </div>
              </div>

              <div className="shrink-0 w-full sm:w-auto">
                <button
                  onClick={handleExecuteSandbox}
                  disabled={isExecutingSandbox}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-950/20"
                >
                  {isExecutingSandbox ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {isExecutingSandbox ? "Running in Sandbox..." : "📟 Execute Binary Tool"}
                </button>
              </div>
            </div>

            {/* Retro green terminal output */}
            <div className="bg-black border border-slate-900 rounded-xl overflow-hidden shadow-2xl flex flex-col flex-1 h-[320px]">
              <div className="bg-slate-950 px-4 py-2 border-b border-slate-900/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-[9.5px] font-mono text-slate-500 ml-2">AnyRealm Sandbox Namespace Virtual Terminal</span>
                </div>
                <span className="text-[9px] font-mono text-indigo-400 uppercase font-bold">Secure Jail Active</span>
              </div>

              <div className="p-4 bg-black font-mono text-xs text-emerald-400 space-y-1 overflow-y-auto scrollbar-none h-full flex-1">
                {sandboxLogs.map((log, index) => (
                  <div key={index} className={`leading-relaxed ${log.startsWith('$') ? 'text-white font-bold' : log.startsWith('[ERROR]') ? 'text-red-400' : log.startsWith('[SUCCESS]') || log.includes('passed green!') ? 'text-emerald-300 font-bold' : 'text-emerald-500/90'}`}>
                    {log}
                  </div>
                ))}
                {isExecutingSandbox && (
                  <div className="text-white italic animate-pulse">Running process in local sandboxed environment, parsing ld-linux dynamic linker path overlays...</div>
                )}
              </div>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
