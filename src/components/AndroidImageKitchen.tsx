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
  Sliders, 
  FileCode, 
  FolderTree, 
  Hammer, 
  Play, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  ChevronRight, 
  Download, 
  FileText, 
  ShieldAlert, 
  Flame, 
  Edit3, 
  Copy, 
  Info, 
  Check,
  FolderOpen,
  Monitor,
  Smartphone,
  Laptop,
  Database,
  HardDrive,
  Zap
} from 'lucide-react';

interface ImageFileTemplate {
  id: string;
  name: string;
  type: 'boot' | 'vendor_boot' | 'recovery';
  osVersion: string;
  patchLevel: string;
  headerVersion: number;
  pageSize: number;
  cmdline: string;
  compression: 'gzip' | 'lz4' | 'lzma' | 'xz' | 'bzip2';
  kernelBase: string;
  ramdiskOffset: string;
  tagsOffset: string;
  dtbPresent: boolean;
  dtbOffset?: string;
  sizeBytes: number;
}

interface RamdiskFile {
  path: string;
  description: string;
  content: string;
  modified: boolean;
}

export default function AndroidImageKitchen() {
  // Available stock presets to unpack
  const stockImageTemplates: ImageFileTemplate[] = [
    {
      id: 'pixel8-boot',
      name: 'Google Pixel 8 Pro Core (v4 Header)',
      type: 'boot',
      osVersion: '14.0.0',
      patchLevel: '2026-06-05',
      headerVersion: 4,
      pageSize: 4096,
      cmdline: 'console=ttyMSM0,115200 androidboot.hardware=shiba loop.max_part=7 bootdevice=11120000.ufs androidboot.boot_devices=11120000.ufs',
      compression: 'lz4',
      kernelBase: '0x00000000',
      ramdiskOffset: '0x01100000',
      tagsOffset: '0x00000100',
      dtbPresent: true,
      dtbOffset: '0x0f000000',
      sizeBytes: 67108864 // 64MB
    },
    {
      id: 's24-vendor-boot',
      name: 'Samsung Galaxy S24 Ultra (v3 Header)',
      type: 'vendor_boot',
      osVersion: '14.0.0',
      patchLevel: '2026-05-01',
      headerVersion: 3,
      pageSize: 4096,
      cmdline: 'androidboot.hardware=qcom service_locator.enable=1 earlycon=msm_geni_serial,0xa90000 loop.max_part=7',
      compression: 'gzip',
      kernelBase: '0x00000000',
      ramdiskOffset: '0x01000000',
      tagsOffset: '0x00000100',
      dtbPresent: true,
      dtbOffset: '0x0e400000',
      sizeBytes: 98566144 // 94MB
    },
    {
      id: 'generic-mtk-recovery',
      name: 'Generic MediaTek MT6789 Recovery (v2 Header)',
      type: 'recovery',
      osVersion: '13.0.0',
      patchLevel: '2025-11-05',
      headerVersion: 2,
      pageSize: 2048,
      cmdline: 'bootopt=64S3,32S1,32S1 buildvariant=userdebug androidboot.selinux=permissive loglevel=4',
      compression: 'xz',
      kernelBase: '0x40000000',
      ramdiskOffset: '0x44000000',
      tagsOffset: '0x40000100',
      dtbPresent: false,
      sizeBytes: 33554432 // 32MB
    }
  ];

  // Active state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('pixel8-boot');
  const [customImageFile, setCustomImageFile] = useState<{ name: string; size: string } | null>(null);
  const [targetPlatform, setTargetPlatform] = useState<'linux' | 'android' | 'windows'>('linux');
  
  // Loaded/dissected headers
  const [imageType, setImageType] = useState<'boot' | 'vendor_boot' | 'recovery'>('boot');
  const [headerVersion, setHeaderVersion] = useState<number>(4);
  const [pageSize, setPageSize] = useState<number>(4096);
  const [cmdline, setCmdline] = useState<string>('');
  const [compression, setCompression] = useState<'gzip' | 'lz4' | 'lzma' | 'xz' | 'bzip2'>('lz4');
  const [kernelBase, setKernelBase] = useState<string>('0x00000000');
  const [ramdiskOffset, setRamdiskOffset] = useState<string>('0x01100000');
  const [tagsOffset, setTagsOffset] = useState<string>('0x00000100');
  const [osVersion, setOsVersion] = useState<string>('14.0.0');
  const [patchLevel, setPatchLevel] = useState<string>('2026-06-05');
  const [dtbOffset, setDtbOffset] = useState<string>('0x0f000000');
  
  // Custom hacks and toggle states
  const [dmVerityDisabled, setDmVerityDisabled] = useState<boolean>(false);
  const [adbUnsecured, setAdbUnsecured] = useState<boolean>(false);
  const [selinuxPermissive, setSelinuxPermissive] = useState<boolean>(false);
  const [rootAccessInjected, setRootAccessInjected] = useState<boolean>(false);

  // Ramdisk Files Virtual Directory
  const [ramdiskFiles, setRamdiskFiles] = useState<RamdiskFile[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [editingContent, setEditingContent] = useState<string>('');

  // Execution states
  const [isUnpacking, setIsUnpacking] = useState<boolean>(false);
  const [isRepacking, setIsRepacking] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<'unpacked' | 'repacked' | 'idle'>('idle');
  const [aikConsoleLogs, setAikConsoleLogs] = useState<string[]>([]);
  const [activeTerminalTab, setActiveTerminalTab] = useState<'output' | 'script'>('output');

  // Compression & File System State
  const [erofsCompressionAlg, setErofsCompressionAlg] = useState<'lz4' | 'lz4hc' | 'zstd' | 'none'>('lz4hc');
  const [erofsCompressionLevel, setErofsCompressionLevel] = useState<number>(9);
  const [erofsBlockSize, setErofsBlockSize] = useState<number>(4096);
  const [erofsDedupe, setErofsDedupe] = useState<boolean>(true);
  const [erofsSharedBlocks, setErofsSharedBlocks] = useState<boolean>(false);
  const [erofsTargetPartition, setErofsTargetPartition] = useState<string>('system');
  const [erofsSourceDir, setErofsSourceDir] = useState<string>('/home/user/workspace/system_out');
  const [isBuildingErofs, setIsBuildingErofs] = useState<boolean>(false);
  const [erofsBuildSuccess, setErofsBuildSuccess] = useState<boolean>(false);
  const [erofsReport, setErofsReport] = useState<{
    originalSize: string;
    compressedSize: string;
    ratio: string;
    blocksWritten: number;
  } | null>(null);

  const [zramCompressionAlg, setZramCompressionAlg] = useState<'lz4' | 'zstd' | 'lzo-rle' | 'lzo'>('zstd');
  const [zramSizeMb, setZramSizeMb] = useState<number>(4096);
  const [zramMaxStreams, setZramMaxStreams] = useState<number>(8);
  const [zramSwappiness, setZramSwappiness] = useState<number>(100);
  const [zramWritebackEnabled, setZramWritebackEnabled] = useState<boolean>(false);
  const [zramBackingDevice, setZramBackingDevice] = useState<string>('/dev/block/by-name/zram_wb');
  const [zramInjected, setZramInjected] = useState<boolean>(false);

  // Local AI Agents & Models (Ollama/Llama) state
  const [useOllamaServer, setUseOllamaServer] = useState<boolean>(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState<string>('http://localhost:11434');
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>('llama3.2');
  const [customOllamaModel, setCustomOllamaModel] = useState<string>('');
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'connected' | 'error' | 'testing'>('idle');
  const [availableModels, setAvailableModels] = useState<string[]>(['llama3.2', 'llama3', 'gemma2', 'mistral', 'codellama']);
  const [showCorsHelp, setShowCorsHelp] = useState<boolean>(false);
  
  const [aiChatInput, setAiChatInput] = useState<string>('');
  const [aiChatHistory, setAiChatHistory] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
    model: string;
    timestamp: string;
    isVirtualPatch?: boolean;
    patchDetails?: {
      fstabPatch?: string;
      propPatch?: string;
      initPatch?: string;
    }
  }>>([
    {
      role: 'assistant',
      content: "Hello! I am your Local AI Agent Optimizer, specialized in micro-kernels, AOSP ramdisks, and system-level compression techniques. I can talk directly to your locally running Ollama instance, or simulate highly customized model recommendations.\n\nChoose an action below, or ask any technical boot questions to get started!",
      model: 'System Copilot',
      timestamp: new Date().toLocaleTimeString(),
    }
  ]);
  const [aiChatLoading, setAiChatLoading] = useState<boolean>(false);

  // Load a preset template
  const loadPresetTemplate = (id: string, platformOverride?: 'linux' | 'android' | 'windows') => {
    const template = stockImageTemplates.find(t => t.id === id);
    if (!template) return;

    const currentPlat = platformOverride || targetPlatform;

    setImageType(template.type);
    setHeaderVersion(template.headerVersion);
    setPageSize(template.pageSize);
    setCmdline(template.cmdline);
    setCompression(template.compression);
    setKernelBase(template.kernelBase);
    setRamdiskOffset(template.ramdiskOffset);
    setTagsOffset(template.tagsOffset);
    setOsVersion(template.osVersion);
    setPatchLevel(template.patchLevel);
    setDtbOffset(template.dtbOffset || '0x00000000');
    setCustomImageFile(null);

    // Populate simulated Ramdisk Files
    const simulatedFiles: RamdiskFile[] = [
      {
        path: 'init.rc',
        description: 'Primary system initialization boot sequence & trigger handlers',
        content: `# Any RealM AOSP Ramdisk core initialization\nimport /init.environ.rc\nimport /init.usb.rc\nimport /init.container.rc\n\non early-init\n    # Start tracing and disable security blocks during dev\n    write /proc/sys/kernel/sysrq 1\n    restorecon /post_install\n\non init\n    sysclktz 0\n    # Setup system mount paths\n    mkdir /mnt/secure 0700 root root\n    mkdir /mnt/secure/staging 0700 root root\n\non post-fs-data\n    # Start driver registers\n    trigger colorsensor_start\n\non colorsensor_start\n    start custom_sensor_service\n`,
        modified: false
      },
      {
        path: 'default.prop',
        description: 'System-wide debug properties read during early zygote bootstrap',
        content: `# Default properties built by Any RealM Image Kitchen\nro.secure=1\nro.allow.mock.locations=0\nro.debuggable=0\nro.adb.secure=1\npersist.sys.usb.config=adb\nro.zygote=zygote64_32\n`,
        modified: false
      },
      {
        path: 'fstab.hardware',
        description: 'Static partition mount table and dm-verity cryptographic block rules',
        content: `# Mount configurations - Custom AOSP Board\n/dev/block/by-name/system  /system  erofs  ro  wait,slotselect,avb=vbmeta,logical,first_stage_mount\n/dev/block/by-name/vendor  /vendor  erofs  ro  wait,slotselect,avb,logical,first_stage_mount\n/dev/block/by-name/userdata /data  f2fs  noatime,nosuid,nodev,discard  wait,check,formattable,fileencryption=aes-256-xts:aes-256-cts\n/dev/block/by-name/metadata /metadata ext4 noatime,nosuid,nodev wait,formattable\n`,
        modified: false
      },
      {
        path: 'ueventd.rc',
        description: 'Kernel device node permission bindings (/dev/*)',
        content: `# Dev nodes matching custom hardware components\n/dev/colorsensor          0660   system     system\n/dev/ion                  0664   system     system\n/dev/binder               0666   root       root\n/dev/ashmem               0666   root       root\n`,
        modified: false
      }
    ];

    setRamdiskFiles(simulatedFiles);
    setSelectedFileIndex(0);
    setEditingContent(simulatedFiles[0].content);

    const platformLogs: Record<'linux' | 'android' | 'windows', string[]> = {
      windows: [
        `[AIK-HOST] Initialized workspace under Windows Host environment (CMD / Cygwin emulation)`,
        `[AIK-HOST] Active workspace directory: C:\\AIK_Studio`,
        `[AIK-HOST] Template loaded: ${template.name} (${template.type.toUpperCase()})`,
        `[AIK-HOST] Active script: unpackimg.bat (Cygwin-based x86_64 / arm64 PE)`,
        `[AIK-HOST] Awaiting unpacking command...`
      ],
      linux: [
        `[AIK-HOST] Initialized workspace under Linux x86_64 Host environment`,
        `[AIK-HOST] Active workspace directory: /home/user/aik/`,
        `[AIK-HOST] Template loaded: ${template.name} (${template.type.toUpperCase()})`,
        `[AIK-HOST] Active script: ./unpackimg.sh (ELF toolchain)`,
        `[AIK-HOST] Awaiting unpacking command...`
      ],
      android: [
        `[AIK-HOST] Initialized workspace on Android Device (Termux Native ARM64 Shell)`,
        `[AIK-HOST] Active workspace directory: /data/data/com.termux/files/home/aik/`,
        `[AIK-HOST] Template loaded: ${template.name} (${template.type.toUpperCase()})`,
        `[AIK-HOST] Active command: termux-chroot ./unpackimg.sh (Static precompiled ARM64 toolchain)`,
        `[AIK-HOST] Awaiting unpacking command...`
      ]
    };

    setAikConsoleLogs(platformLogs[currentPlat]);
    setActiveStep('idle');
    // reset hacks
    setDmVerityDisabled(false);
    setAdbUnsecured(false);
    setSelinuxPermissive(false);
    setRootAccessInjected(false);
  };

  // Run on mount
  useEffect(() => {
    loadPresetTemplate('pixel8-boot');
  }, []);

  // Sync editor when file selection changes
  const handleSelectFile = (index: number) => {
    // save current file first
    const updated = [...ramdiskFiles];
    updated[selectedFileIndex].content = editingContent;
    setRamdiskFiles(updated);

    setSelectedFileIndex(index);
    setEditingContent(updated[index].content);
  };

  // Custom code editor change handler
  const handleContentChange = (val: string) => {
    setEditingContent(val);
    const updated = [...ramdiskFiles];
    updated[selectedFileIndex].content = val;
    updated[selectedFileIndex].modified = true;
    setRamdiskFiles(updated);
  };

  // Fast toggling of hacks
  const toggleHack = (hackType: 'verity' | 'adb' | 'selinux' | 'root') => {
    if (activeStep !== 'unpacked') {
      setAikConsoleLogs(prev => [...prev, `[AIK-ERROR] You must unpack the image before applying ramdisk hacks!`]);
      return;
    }

    if (hackType === 'verity') {
      const active = !dmVerityDisabled;
      setDmVerityDisabled(active);
      
      // Patch fstab
      const updated = [...ramdiskFiles];
      const fstabIndex = updated.findIndex(f => f.path.startsWith('fstab'));
      if (fstabIndex !== -1) {
        let content = updated[fstabIndex].content;
        if (active) {
          content = content.replace(/avb=vbmeta/g, 'nofail').replace(/avb/g, 'nofail');
          setAikConsoleLogs(prev => [...prev, `[AIK-PATCH] Modified fstab.hardware to bypass dm-verity / AVB check.`]);
        } else {
          // reload original
          content = stockImageTemplates.find(t => t.id === selectedTemplateId)?.type === 'vendor_boot'
            ? `# Mount configurations - Custom AOSP Board\n/dev/block/by-name/system  /system  erofs  ro  wait,slotselect,avb=vbmeta,logical,first_stage_mount\n`
            : `/dev/block/by-name/system  /system  erofs  ro  wait,slotselect,avb=vbmeta,logical,first_stage_mount\n/dev/block/by-name/vendor  /vendor  erofs  ro  wait,slotselect,avb,logical,first_stage_mount\n/dev/block/by-name/userdata /data  f2fs  noatime,nosuid,nodev,discard  wait,check,formattable,fileencryption=aes-256-xts:aes-256-cts\n`;
        }
        updated[fstabIndex].content = content;
        updated[fstabIndex].modified = true;
        setRamdiskFiles(updated);
        if (selectedFileIndex === fstabIndex) {
          setEditingContent(content);
        }
      }
    }

    if (hackType === 'adb') {
      const active = !adbUnsecured;
      setAdbUnsecured(active);

      // Patch default.prop
      const updated = [...ramdiskFiles];
      const propIndex = updated.findIndex(f => f.path === 'default.prop');
      if (propIndex !== -1) {
        let content = updated[propIndex].content;
        if (active) {
          content = content
            .replace(/ro.secure=1/g, 'ro.secure=0')
            .replace(/ro.debuggable=0/g, 'ro.debuggable=1')
            .replace(/ro.adb.secure=1/g, 'ro.adb.secure=0');
          setAikConsoleLogs(prev => [...prev, `[AIK-PATCH] Patched default.prop: secure=0, debuggable=1, adb.secure=0`]);
        } else {
          content = `# Default properties built by Any RealM Image Kitchen\nro.secure=1\nro.allow.mock.locations=0\nro.debuggable=0\nro.adb.secure=1\npersist.sys.usb.config=adb\nro.zygote=zygote64_32\n`;
        }
        updated[propIndex].content = content;
        updated[propIndex].modified = true;
        setRamdiskFiles(updated);
        if (selectedFileIndex === propIndex) {
          setEditingContent(content);
        }
      }
    }

    if (hackType === 'selinux') {
      const active = !selinuxPermissive;
      setSelinuxPermissive(active);

      if (active) {
        // Add androidboot.selinux=permissive to cmdline
        if (!cmdline.includes('androidboot.selinux=permissive')) {
          setCmdline(prev => prev + ' androidboot.selinux=permissive');
          setAikConsoleLogs(prev => [...prev, `[AIK-PATCH] Added permissive boot flag to cmdline file.`]);
        }
      } else {
        setCmdline(prev => prev.replace(' androidboot.selinux=permissive', ''));
      }
    }

    if (hackType === 'root') {
      const active = !rootAccessInjected;
      setRootAccessInjected(active);

      // Patch init.rc to launch custom root daemon or bypass checks
      const updated = [...ramdiskFiles];
      const initIndex = updated.findIndex(f => f.path === 'init.rc');
      if (initIndex !== -1) {
        let content = updated[initIndex].content;
        if (active) {
          content += `\n# Custom any_realm superuser daemon injector\nservice custom_root_daemon /sbin/su --daemon\n    class core\n    user root\n    group root\n    seclabel u:r:su:s0\n    writepid /dev/cpuset/foreground/tasks\n`;
          setAikConsoleLogs(prev => [...prev, `[AIK-PATCH] Appended custom /sbin/su root daemon registration to init.rc.`]);
        } else {
          content = content.split('\n# Custom any_realm superuser daemon injector')[0];
        }
        updated[initIndex].content = content;
        updated[initIndex].modified = true;
        setRamdiskFiles(updated);
        if (selectedFileIndex === initIndex) {
          setEditingContent(content);
        }
      }
    }
  };

  // Simulated AIK Unpacker
  const handleUnpackImage = () => {
    setIsUnpacking(true);
    
    const isWin = targetPlatform === 'windows';
    const isAnd = targetPlatform === 'android';
    
    const commandLinePrompt = isWin 
      ? `C:\\AIK_Studio> unpackimg.bat "${imageType}.img"`
      : isAnd 
        ? `termux-chroot $ ./unpackimg.sh "${imageType}.img"`
        : `$ ./unpackimg.sh "${imageType}.img"`;

    setAikConsoleLogs(prev => [
      ...prev,
      commandLinePrompt,
      isWin 
        ? `Android Image Kitchen - Unpackimg Script for Windows (v3.8-Cygwin)`
        : isAnd 
          ? `Android Image Kitchen - Unpackimg Script for Android-Termux (v3.8-ARM64)`
          : `Android Image Kitchen - Unpackimg Script for Linux x86_64 (v3.8)`,
      `by Osm0sis @ xda-developers`,
      ``,
      `[AIK] Target image: ${imageType}.img`,
      `[AIK] Reading image headers and magic bytes...`
    ]);

    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step === 1) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Detected Header Version: ${headerVersion}`,
          `[AIK] Page Size configuration: ${pageSize} bytes`,
          `[AIK] Base Memory Address: ${kernelBase}`
        ]);
      } else if (step === 2) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Ramdisk Offset Address: ${ramdiskOffset}`,
          `[AIK] Tags Offset Address: ${tagsOffset}`,
          headerVersion >= 3 ? `[AIK] DTB Block Offset: ${dtbOffset}` : `[AIK] DTB is concatenated to kernel`
        ]);
      } else if (step === 3) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Command Line parameters: "${cmdline}"`,
          `[AIK] Sifting compression format... Detected: [${compression.toUpperCase()}]`
        ]);
      } else if (step === 4) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Splitting kernel and ramdisk payloads...`,
          isWin
            ? `[AIK] Extracting ramdisk payload to virtual path: "C:\\AIK_Studio\\ramdisk\\"`
            : isAnd
              ? `[AIK] Extracting ramdisk payload to local path: "/data/data/com.termux/files/home/aik/ramdisk/"`
              : `[AIK] Extracting ramdisk payload to local path: "/ramdisk/"`,
          `[AIK] Successfully expanded virtual directory files (init.rc, default.prop, fstab...)`
        ]);
      } else if (step === 5) {
        setAikConsoleLogs(prev => [
          ...prev,
          isWin 
            ? `[AIK] Unpack completed successfully. Directory mounted as RW under Windows host!`
            : `[AIK] Unpack completed successfully. Virtual filesystem mounted as RW!`,
          `[AIK] Ready for offline ramdisk modifications.`
        ]);
        setIsUnpacking(false);
        setActiveStep('unpacked');
        clearInterval(interval);
      }
    }, 400);
  };

  // Simulated AIK Repacker
  const handleRepackImage = () => {
    if (activeStep !== 'unpacked') {
      setAikConsoleLogs(prev => [...prev, `[AIK-ERROR] Nothing to repack! Please unpack an image first.`]);
      return;
    }

    setIsRepacking(true);
    
    const isWin = targetPlatform === 'windows';
    const isAnd = targetPlatform === 'android';
    
    const commandLinePrompt = isWin 
      ? `C:\\AIK_Studio> repackimg.bat`
      : isAnd 
        ? `termux-chroot $ ./repackimg.sh`
        : `$ ./repackimg.sh`;

    setAikConsoleLogs(prev => [
      ...prev,
      commandLinePrompt,
      isWin 
        ? `Android Image Kitchen - Repackimg Script for Windows (v3.8-Cygwin)`
        : isAnd 
          ? `Android Image Kitchen - Repackimg Script for Android-Termux (v3.8-ARM64)`
          : `Android Image Kitchen - Repackimg Script for Linux x86_64 (v3.8)`,
      `by Osm0sis @ xda-developers`,
      ``,
      isWin
        ? `[AIK] Preparing source ramdisk components from "C:\\AIK_Studio\\ramdisk\\"`
        : isAnd
          ? `[AIK] Preparing source ramdisk components from "/data/data/com.termux/files/home/aik/ramdisk/"`
          : `[AIK] Preparing source ramdisk components from "/ramdisk/"`,
      `[AIK] Encoding compression: [${compression.toUpperCase()}]`
    ]);

    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step === 1) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Scanning ramdisk files:`,
          ...ramdiskFiles.map(f => isWin 
            ? `  -> C:\\AIK_Studio\\ramdisk\\${f.path.replace(/\//g, '\\')} ${f.modified ? '(PATCHED)' : '(Unmodified)'}`
            : `  -> /ramdisk/${f.path} ${f.modified ? '(PATCHED)' : '(Unmodified)'}`
          )
        ]);
      } else if (step === 2) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Packing ramdisk.cpio.${compression}... Done!`,
          `[AIK] Building Android Boot Image Header (Version ${headerVersion}):`,
          `   - cmdline="${cmdline}"`,
          `   - pagesize=${pageSize}`,
          `   - kernel_base=${kernelBase}`,
          `   - ramdisk_offset=${ramdiskOffset}`
        ]);
      } else if (step === 3) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Appending boot cryptographic sign footer (AVB hash footer)...`,
          `[AIK] Signing with release-keys via avbtool...`,
          `[AIK] Built signature: vbm_hash="7f8da790ce0f66e..."`
        ]);
      } else if (step === 4) {
        const outName = `new-${imageType}.img`;
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK] Successfully compiled new image: [${outName}]`,
          `[AIK] Repack stage: SUCCESS. Flashing instructions generated.`,
          `------------------------------------------------------------------`,
          `To write onto target Any RealM board, execute:`,
          isWin
            ? `  C:\\AIK_Studio> fastboot.exe flash ${imageType} ${outName}`
            : `  $ fastboot flash ${imageType} ${outName}`
        ]);
        setIsRepacking(false);
        setActiveStep('repacked');
        clearInterval(interval);
      }
    }, 500);
  };

  // Clear workspace
  const handleClearWorkspace = () => {
    loadPresetTemplate(selectedTemplateId);
  };

  const handleInjectZram = () => {
    if (activeStep !== 'unpacked') {
      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-ERROR] Cannot inject ZRAM parameters! You must unpack an image first.`,
      ]);
      return;
    }

    setAikConsoleLogs(prev => [
      ...prev,
      `[AIK-PATCH] Commencing ZRAM & Swapping Optimization injection...`,
    ]);

    // 1. Patch fstab.hardware
    const updatedFiles = [...ramdiskFiles];
    const fstabIndex = updatedFiles.findIndex(f => f.path.startsWith('fstab'));
    let fstabPatched = false;
    if (fstabIndex !== -1) {
      let content = updatedFiles[fstabIndex].content;
      
      const zramSizeInBytes = zramSizeMb * 1024 * 1024;
      const zramPattern = /\/dev\/block\/zram0\s+none\s+swap\s+[\w,=\s%.-]+/g;
      const newZramLine = `/dev/block/zram0 none swap defaults zramsize=${zramSizeInBytes},max_comp_streams=${zramMaxStreams}`;

      if (content.match(zramPattern)) {
        content = content.replace(zramPattern, newZramLine);
      } else {
        content += `\n# Enhanced ZRAM Swap Device Configured via AIK Compression Studio\n${newZramLine}\n`;
      }

      updatedFiles[fstabIndex].content = content;
      updatedFiles[fstabIndex].modified = true;
      fstabPatched = true;
      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-PATCH] Patched fstab.hardware to register ZRAM swap with size=${zramSizeMb}MB (~${(zramSizeMb/1024).toFixed(1)}GB) and streams=${zramMaxStreams}.`
      ]);
    }

    // 2. Patch default.prop
    const propIndex = updatedFiles.findIndex(f => f.path === 'default.prop');
    let propPatched = false;
    if (propIndex !== -1) {
      let content = updatedFiles[propIndex].content;
      content = content.replace(/# ZRAM Configurations[\s\S]*$/, '');
      
      content += `\n# ZRAM Configurations injected dynamically\n`;
      content += `ro.zram.first_wb_delay_mins=${zramWritebackEnabled ? '180' : '0'}\n`;
      content += `ro.zram.comp_algorithm=${zramCompressionAlg}\n`;
      content += `persist.sys.zram_enabled=true\n`;

      updatedFiles[propIndex].content = content;
      updatedFiles[propIndex].modified = true;
      propPatched = true;
      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-PATCH] Patched default.prop: algorithm=${zramCompressionAlg.toUpperCase()}, writeback_delay=${zramWritebackEnabled ? '180m' : 'none'}.`
      ]);
    }

    // 3. Patch init.rc
    const initIndex = updatedFiles.findIndex(f => f.path === 'init.rc');
    let initPatched = false;
    if (initIndex !== -1) {
      let content = updatedFiles[initIndex].content;
      content = content.replace(/# AIK ZRAM BOOT LOOPS[\s\S]*$/, '');

      content += `\n# AIK ZRAM BOOT LOOPS\non boot\n`;
      content += `    # Configure compression algorithm in sysfs before activating swap\n`;
      content += `    write /sys/block/zram0/comp_algorithm ${zramCompressionAlg}\n`;
      content += `    write /sys/block/zram0/max_comp_streams ${zramMaxStreams}\n`;
      if (zramWritebackEnabled) {
        content += `    # Configure backing device for ZRAM writeback swaps\n`;
        content += `    write /sys/block/zram0/backing_dev ${zramBackingDevice}\n`;
      }
      content += `    # Adjust Swappiness VM parameters\n`;
      content += `    write /proc/sys/vm/swappiness ${zramSwappiness}\n`;

      updatedFiles[initIndex].content = content;
      updatedFiles[initIndex].modified = true;
      initPatched = true;
      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-PATCH] Appended sysfs hook bindings into init.rc to write swappiness=${zramSwappiness} and comp_algorithm=${zramCompressionAlg}.`
      ]);
    }

    setRamdiskFiles(updatedFiles);
    
    const currentPath = ramdiskFiles[selectedFileIndex]?.path;
    if (currentPath) {
      const reFoundIndex = updatedFiles.findIndex(f => f.path === currentPath);
      if (reFoundIndex !== -1) {
        setEditingContent(updatedFiles[reFoundIndex].content);
      }
    }

    setZramInjected(true);
    setAikConsoleLogs(prev => [
      ...prev,
      `[AIK-PATCH] ZRAM SWAP CONFIGURATION INJECTED SUCCESSFULLY. Re-pack target image to bake.`,
    ]);
  };

  const handleBuildErofs = () => {
    setIsBuildingErofs(true);
    setErofsBuildSuccess(false);
    setErofsReport(null);

    setAikConsoleLogs(prev => [
      ...prev,
      `$ mkfs.erofs -z${erofsCompressionAlg}${erofsCompressionAlg !== 'none' ? `,${erofsCompressionLevel}` : ''} -C${erofsBlockSize} ${erofsDedupe ? '-zdedupe ' : ''}${erofsSharedBlocks ? '--shared-blocks ' : ''}${erofsTargetPartition}.erofs.img ${erofsSourceDir}`,
      `mkfs.erofs v1.6 (Enhanced Read-Only File System Builder)`,
      `Initializing EROFS layout configuration: block_size=${erofsBlockSize} compression=${erofsCompressionAlg.toUpperCase()}`
    ]);

    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step === 1) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[EROFS] Scanning directory "${erofsSourceDir}" recursively...`,
          `[EROFS] Found 4,185 items (files, symlinks, directories). Generating inode map...`
        ]);
      } else if (step === 2) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[EROFS] Initializing parallel multi-threaded compressor (using ${zramMaxStreams} cores)`,
          erofsDedupe ? `[EROFS] Content deduplication active. Scanning duplicate file blocks...` : `[EROFS] Content deduplication is bypassed.`
        ]);
      } else if (step === 3) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[EROFS] Compressing block data structures with ${erofsCompressionAlg.toUpperCase()}-${erofsCompressionLevel}...`,
          `[EROFS]   /system/framework/boot.oat -> Compressed [74% reduction]`,
          `[EROFS]   /system/lib64/libart.so    -> Compressed [58% reduction]`
        ]);
      } else if (step === 4) {
        const origBytes = 1845493760; 
        const reductionMap: Record<'lz4' | 'lz4hc' | 'zstd' | 'none', number> = {
          lz4: 0.45,  
          lz4hc: 0.38, 
          zstd: 0.31,  
          none: 1.0    
        };
        const compBytes = Math.round(origBytes * reductionMap[erofsCompressionAlg]);
        const savingPercent = Math.round((1 - compBytes / origBytes) * 100);

        setErofsReport({
          originalSize: `${(origBytes / 1024 / 1024).toFixed(1)} MB`,
          compressedSize: `${(compBytes / 1024 / 1024).toFixed(1)} MB`,
          ratio: `${savingPercent}% Space Saved`,
          blocksWritten: Math.ceil(compBytes / erofsBlockSize)
        });

        setAikConsoleLogs(prev => [
          ...prev,
          `[EROFS] Image building completed.`,
          `[EROFS] Original Directory Size: ${(origBytes / 1024 / 1024).toFixed(1)} MB`,
          `[EROFS] Compressed EROFS Size: ${(compBytes / 1024 / 1024).toFixed(1)} MB (${savingPercent}% savings)`,
          `[EROFS] Written ${Math.ceil(compBytes / erofsBlockSize)} blocks. Superblock layout confirmed!`,
          `[EROFS] Output image created: ${erofsTargetPartition}.erofs.img`
        ]);
        setErofsBuildSuccess(true);
        setIsBuildingErofs(false);
        clearInterval(interval);
      }
    }, 400);
  };

  const handleTestOllamaConnection = async (customUrl?: string) => {
    const url = customUrl || ollamaEndpoint;
    setOllamaStatus('testing');
    setAikConsoleLogs(prev => [
      ...prev,
      `[AIK-OLLAMA] Probing local Ollama server at: ${url}...`,
    ]);
    try {
      const res = await fetch(`${url}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const models = data.models ? data.models.map((m: any) => m.name) : [];
        setOllamaStatus('connected');
        setUseOllamaServer(true);
        if (models.length > 0) {
          setAvailableModels(models);
          setSelectedOllamaModel(models[0]);
        }
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK-OLLAMA] Connection SUCCESSFUL! Found ${models.length} local models.`,
          ...models.map((m: string) => `  -> Found model: ${m}`),
        ]);
      } else {
        setOllamaStatus('connected');
        setUseOllamaServer(true);
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK-OLLAMA] Connection detected, but model list query was refused. Defaulting to active model selection.`,
        ]);
      }
    } catch (err) {
      setOllamaStatus('error');
      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-OLLAMA] ERROR: Connection failed. Ollama may be offline or blocked by CORS headers.`,
        `[AIK-OLLAMA] Help: Start Ollama with OLLAMA_ORIGINS="*" before executing local requests!`,
      ]);
    }
  };

  const simulateLocalResponse = (prompt: string) => {
    const lowercasePrompt = prompt.toLowerCase();
    let reply = '';
    let isVirtualPatch = false;
    let patchDetails: any = undefined;

    if (lowercasePrompt.includes('ramdisk') || lowercasePrompt.includes('fstab') || lowercasePrompt.includes('optimize')) {
      reply = `### Local Llama Agent - AOSP Ramdisk Optimization Analysis

Based on your active image template (**${selectedTemplateId}**) and the requested platform (**${targetPlatform}**), here is a custom optimization blueprint for your file system mount boundaries.

#### 1. Optimization Overview:
Your current mounting table uses \`erofs\` for system read-only directories, which is excellent. We can enhance latency performance by fine-tuning the flags for the \`userdata\` mount parameters in \`fstab.hardware\`.

#### 2. Suggested virtual configuration patches:
\`\`\`fstab
# Optimized Mount configs - Custom AOSP Board
/dev/block/by-name/system  /system  erofs  ro  wait,slotselect,avb=vbmeta,logical,first_stage_mount
/dev/block/by-name/vendor  /vendor  erofs  ro  wait,slotselect,avb,logical,first_stage_mount
# PATCHED: Configured high-performance f2fs mount settings
/dev/block/by-name/userdata /data  f2fs  noatime,nosuid,nodev,discard,inline_xattr,inline_data,reserve_root=32768,resgid=1065,fsync_mode=nobarrier  wait,check,formattable,fileencryption=aes-256-xts:aes-256-cts,keydirectory=/metadata/vold/metadata_encryption,zramsize=${zramSizeMb*1024*1024}
\`\`\`;

#### 3. How to Apply:
You can click the **"Apply Optimizer Patches"** button below to inject this recommended partition mount table directly into your ramdisk's virtual workspace!`;
      
      isVirtualPatch = true;
      patchDetails = {
        fstabPatch: `# Mount configurations - Optimized via Llama Co-Pilot\n/dev/block/by-name/system  /system  erofs  ro  wait,slotselect,avb=vbmeta,logical,first_stage_mount\n/dev/block/by-name/vendor  /vendor  erofs  ro  wait,slotselect,avb,logical,first_stage_mount\n/dev/block/by-name/userdata /data  f2fs  noatime,nosuid,nodev,discard,inline_xattr,inline_data,reserve_root=32768,resgid=1065,fsync_mode=nobarrier  wait,check,formattable,fileencryption=aes-256-xts:aes-256-cts,keydirectory=/metadata/vold/metadata_encryption,zramsize=${zramSizeMb*1024*1024}\n`
      };
    } else if (lowercasePrompt.includes('zram') || lowercasePrompt.includes('swappiness') || lowercasePrompt.includes('memory')) {
      reply = `### Local Llama Agent - ZRAM Swap & Memory Tuning Blueprint

I have analyzed your requested swap pool setup (**${zramSizeMb} MB** with **${zramCompressionAlg.toUpperCase()}** compression over **${zramMaxStreams} cores**).

#### 1. VM Tunings Suggested:
To maximize the efficacy of your ZRAM pool under Android, the kernel virtual memory (VM) page reclaim parameters must be calibrated.
We will adjust:
- \`swappiness\`: **${zramSwappiness}** (forces the kernel to prefer swapping idle anonymous pages instead of purging essential file-backed system caches, decreasing app launch stutter)
- \`comp_algorithm\`: **${zramCompressionAlg}**

#### 2. Generated Code Blocks:
Here is the customized boot initialization block to paste into your \`init.rc\` setup script:

\`\`\`rc
# AIK ZRAM BOOT LOOPS INJECTED BY LOCAL LLAMA AGENT
on boot
    write /sys/block/zram0/comp_algorithm ${zramCompressionAlg}
    write /sys/block/zram0/max_comp_streams ${zramMaxStreams}
    write /proc/sys/vm/swappiness ${zramSwappiness}
    write /proc/sys/vm/vfs_cache_pressure 70
    write /proc/sys/vm/dirty_ratio 20
    write /proc/sys/vm/dirty_background_ratio 5
\`\`\`

#### 3. Proactive Properties for zygote pre-warming:
\`\`\`prop
# ZRAM Configurations injected dynamically
ro.zram.first_wb_delay_mins=${zramWritebackEnabled ? '180' : '0'}
ro.zram.comp_algorithm=${zramCompressionAlg}
persist.sys.zram_enabled=true
\`\`\`

You can apply these tunings directly using the interactive compiler bindings in the module.`;
      
      isVirtualPatch = true;
      patchDetails = {
        initPatch: `# AIK ZRAM BOOT LOOPS\non boot\n    # Configure compression algorithm in sysfs before activating swap\n    write /sys/block/zram0/comp_algorithm ${zramCompressionAlg}\n    write /sys/block/zram0/max_comp_streams ${zramMaxStreams}\n    # Adjust Swappiness VM parameters\n    write /proc/sys/vm/swappiness ${zramSwappiness}\n    write /proc/sys/vm/vfs_cache_pressure 70\n    write /proc/sys/vm/dirty_ratio 20\n    write /proc/sys/vm/dirty_background_ratio 5\n`,
        propPatch: `# ZRAM Configurations injected dynamically\nro.zram.first_wb_delay_mins=${zramWritebackEnabled ? '180' : '0'}\nro.zram.comp_algorithm=${zramCompressionAlg}\npersist.sys.zram_enabled=true\n`
      };
    } else if (lowercasePrompt.includes('erofs') || lowercasePrompt.includes('compression') || lowercasePrompt.includes('zstd')) {
      reply = `### Local Llama Agent - EROFS Storage Optimization

You are utilizing **EROFS (Enhanced Read-Only File System)** with **${erofsCompressionAlg.toUpperCase()}** compression (Level: **${erofsCompressionLevel}**).

#### EROFS Layout Diagnostics:
1. **ZSTD vs LZ4**:
   - **LZ4/LZ4HC**: Excellent for system partitions where random read execution latency is the absolute bottleneck (e.g. system binaries, shared frameworks).
   - **ZSTD**: Yields up to 25% tighter compression ratio than LZ4HC, making it perfect for massive partitions like \`product.img\` or \`vendor_dlkm.img\`.
2. **Deduplication (\`-zdedupe\`)**:
   - This option saves significant space on Android images by sharing duplicate physical disk sectors. We highly recommend keeping it enabled.

#### Recommended CLI Compilation:
\`\`\`bash
mkfs.erofs -z${erofsCompressionAlg},${erofsCompressionLevel} -C${erofsBlockSize} ${erofsDedupe ? '-zdedupe' : ''} ${erofsTargetPartition}.erofs.img ${erofsSourceDir}
\`\`\``;
    } else {
      reply = `### Local Model Copilot Response (Emulating Llama/Ollama)

Thank you for your inquiry regarding: "${prompt}"

#### Technical Context:
- **Active Board Type**: ${selectedTemplateId.toUpperCase()}
- **Image Partition Type**: ${imageType.toUpperCase()}
- **ZRAM settings**: ${zramSizeMb}MB swap pool using ${zramCompressionAlg.toUpperCase()}

#### Local Agent Recommendations:
1. Ensure your host toolchain has necessary utilities installed. If on Termux, run \`pkg install busybox\`.
2. Keep your header structure aligned to **version ${headerVersion}** as parsed during unpacking.
3. If you run Ollama locally on this machine, configure \`OLLAMA_ORIGINS="*" ollama serve\` to enable direct low-latency browser requests!`;
    }

    setAiChatHistory(prev => [
      ...prev,
      {
        role: 'assistant',
        content: reply,
        model: useOllamaServer ? (customOllamaModel || selectedOllamaModel) : 'Llama-Simulator-Agent',
        timestamp: new Date().toLocaleTimeString(),
        isVirtualPatch,
        patchDetails
      }
    ]);
  };

  const handleSendAiMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || aiChatInput;
    if (!promptToSend.trim()) return;

    const userMsg = {
      role: 'user' as const,
      content: promptToSend,
      model: useOllamaServer ? (customOllamaModel || selectedOllamaModel) : 'Llama-Simulator-Agent',
      timestamp: new Date().toLocaleTimeString(),
    };

    setAiChatHistory(prev => [...prev, userMsg]);
    setAiChatInput('');
    setAiChatLoading(true);

    const activeModel = customOllamaModel || selectedOllamaModel;

    if (useOllamaServer) {
      try {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK-OLLAMA] Dispatching request to local model [${activeModel}] at: ${ollamaEndpoint}...`,
        ]);

        const systemPrompt = `You are a highly advanced Local Android Kernel Agent, specialized in micro-kernels, AOSP ramdisks, and system-level compression techniques (EROFS, LZ4, ZSTD, Swappiness, and ZRAM).
Active Workspace State:
- Target Platform Host OS: ${targetPlatform}
- Image Type: ${imageType}
- stockImageTemplate: ${selectedTemplateId}
- EROFS compression algorithm: ${erofsCompressionAlg} (effort level: ${erofsCompressionLevel})
- ZRAM Sizing: ${zramSizeMb}MB, max streams: ${zramMaxStreams}, VM Swappiness: ${zramSwappiness}
- Active ramdisk files in workspace: ${ramdiskFiles.map(f => f.path).join(', ')}

Please provide clear, professional, and dense technical solutions. If suggesting a patch, please output code sections clearly and explain the performance optimization.`;

        const fullPrompt = `${systemPrompt}\n\nUser Question:\n${promptToSend}`;

        const response = await fetch(`${ollamaEndpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: activeModel,
            prompt: fullPrompt,
            stream: false,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          const replyText = result.response;
          
          let fstabPatch: string | undefined;
          let propPatch: string | undefined;
          let initPatch: string | undefined;

          const fstabMatch = replyText.match(/```(?:fstab|ini|plaintext)?\s*([\s\S]*?zramsize=[\s\S]*?)```/i);
          if (fstabMatch) fstabPatch = fstabMatch[1].trim();

          const propMatch = replyText.match(/```(?:prop|properties)?\s*([\s\S]*?ro\.zram\.[\s\S]*?)```/i);
          if (propMatch) propPatch = propMatch[1].trim();

          const initMatch = replyText.match(/```(?:rc|init)?\s*([\s\S]*?write \/sys\/block\/zram0[\s\S]*?)```/i);
          if (initMatch) initPatch = initMatch[1].trim();

          const hasPatch = !!(fstabPatch || propPatch || initPatch);

          setAiChatHistory(prev => [
            ...prev,
            {
              role: 'assistant',
              content: replyText,
              model: activeModel,
              timestamp: new Date().toLocaleTimeString(),
              isVirtualPatch: hasPatch,
              patchDetails: hasPatch ? { fstabPatch, propPatch, initPatch } : undefined
            }
          ]);
          setAikConsoleLogs(prev => [
            ...prev,
            `[AIK-OLLAMA] Received response from model [${activeModel}]. Generation completed.`,
          ]);
        } else {
          throw new Error(`Ollama returned status: ${response.status}`);
        }
      } catch (err: any) {
        setAikConsoleLogs(prev => [
          ...prev,
          `[AIK-OLLAMA] Generation failed! Falling back to Local Agent Simulator: ${err.message || err}`,
        ]);
        simulateLocalResponse(promptToSend);
      } finally {
        setAiChatLoading(false);
      }
    } else {
      setTimeout(() => {
        simulateLocalResponse(promptToSend);
        setAiChatLoading(false);
      }, 750);
    }
  };

  const handleApplyVirtualPatch = (patch: { fstabPatch?: string; propPatch?: string; initPatch?: string }) => {
    const updatedFiles = [...ramdiskFiles];
    let patchedCount = 0;

    if (patch.fstabPatch) {
      const idx = updatedFiles.findIndex(f => f.path.startsWith('fstab'));
      if (idx !== -1) {
        updatedFiles[idx].content = patch.fstabPatch;
        updatedFiles[idx].modified = true;
        patchedCount++;
      }
    }

    if (patch.propPatch) {
      const idx = updatedFiles.findIndex(f => f.path === 'default.prop');
      if (idx !== -1) {
        updatedFiles[idx].content = patch.propPatch;
        updatedFiles[idx].modified = true;
        patchedCount++;
      }
    }

    if (patch.initPatch) {
      const idx = updatedFiles.findIndex(f => f.path === 'init.rc');
      if (idx !== -1) {
        updatedFiles[idx].content = patch.initPatch;
        updatedFiles[idx].modified = true;
        patchedCount++;
      }
    }

    if (patchedCount > 0) {
      setRamdiskFiles(updatedFiles);
      
      const currentPath = ramdiskFiles[selectedFileIndex]?.path;
      if (currentPath) {
        const reFoundIndex = updatedFiles.findIndex(f => f.path === currentPath);
        if (reFoundIndex !== -1) {
          setEditingContent(updatedFiles[reFoundIndex].content);
        }
      }

      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-PATCH] APPLIED ${patchedCount} OPTIMIZATIONS DIRECTLY FROM LOCAL LLAMA CO-PILOT AGENT!`,
      ]);
    }
  };

  // Manual Image Upload Simulation
  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setCustomImageFile({
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + ' MB'
      });

      // auto-detect type
      let type: 'boot' | 'vendor_boot' | 'recovery' = 'boot';
      if (file.name.includes('vendor_boot')) type = 'vendor_boot';
      else if (file.name.includes('recovery')) type = 'recovery';

      setImageType(type);
      setAikConsoleLogs(prev => [
        ...prev,
        `[AIK-HOST] Imported user file: "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
        `[AIK-HOST] Identified image role: [${type.toUpperCase()}]`,
        `[AIK-HOST] Press "Decompose & Unpack Payload" to start parsing.`
      ]);
    }
  };

  return (
    <div className="flex flex-col gap-8" id="aik-image-kitchen-workspace-root">
      
      {/* 1. COMPONENT TITLE BANNER */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Wrench className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5" /> AIK - Boot Decomposer
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <Wrench className="text-indigo-500 w-7 h-7 animate-spin-slow" /> Android Image Kitchen (AIK) Studio
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Deconstruct, modify, and repack low-level Android kernel partition images (`boot.img`, `vendor_boot.img`, and `recovery.img`). Perform RAMDISK hacks like stripping AVB verification and enabling root.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleClearWorkspace}
              className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-white text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" /> Reset Workspace
            </button>
          </div>
        </div>
      </div>

      {/* HOST OS PLATFORM SELECTOR */}
      <div className="bg-[#0b0f19] border border-slate-900 rounded-2xl p-5 shadow-2xl relative" id="aik-host-os-platform-selector">
        <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Laptop className="w-4 h-4 text-indigo-400" /> Active Host Operating System Platform
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Select the platform where you will run Android Image Kitchen. Script configurations, address paths, and package prerequisites will update dynamically.
            </p>
          </div>
          <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded text-[9.5px] font-mono font-bold uppercase">
            CROSS-PLATFORM ENGINE
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Linux Option */}
          <button
            type="button"
            onClick={() => {
              setTargetPlatform('linux');
              setAikConsoleLogs(prev => [
                ...prev,
                `[AIK-HOST] Target environment switched to Linux (Ubuntu / Debian x86_64).`,
                `[AIK-HOST] Command syntax is updated to ELF './unpackimg.sh' with Unix file-separator forwardslashes.`
              ]);
            }}
            className={`flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all relative overflow-hidden cursor-pointer ${
              targetPlatform === 'linux'
                ? 'bg-gradient-to-br from-indigo-500/15 to-indigo-600/5 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.15)] text-white'
                : 'bg-slate-950/40 border-slate-900 text-slate-400 hover:border-slate-800 hover:bg-slate-950/60'
            }`}
          >
            <div className={`p-2 rounded-lg ${targetPlatform === 'linux' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-900 text-slate-500'}`}>
              <Layers className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold block text-slate-200">Linux x86_64 Host</span>
              <span className="text-[10px] text-slate-500 block mt-0.5 truncate">Debian, Ubuntu, Arch, Fedora</span>
              <span className="inline-block mt-2 px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 text-[8.5px] font-mono rounded font-medium">
                $ ./unpackimg.sh
              </span>
            </div>
            {targetPlatform === 'linux' && (
              <div className="absolute top-0 right-0 w-8 h-8 bg-indigo-500/10 rounded-bl-full flex items-center justify-center">
                <Check className="w-3 h-3 text-indigo-400 mr-1.5 mb-1.5" />
              </div>
            )}
          </button>

          {/* Android Option */}
          <button
            type="button"
            onClick={() => {
              setTargetPlatform('android');
              setAikConsoleLogs(prev => [
                ...prev,
                `[AIK-HOST] Target environment switched to Android Mobile (Termux ARM64 environment).`,
                `[AIK-HOST] Binary mapping adjusted for static arm64-v8a compiler. CLI helper updated to 'termux-chroot'.`
              ]);
            }}
            className={`flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all relative overflow-hidden cursor-pointer ${
              targetPlatform === 'android'
                ? 'bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)] text-white'
                : 'bg-slate-950/40 border-slate-900 text-slate-400 hover:border-slate-800 hover:bg-slate-950/60'
            }`}
          >
            <div className={`p-2 rounded-lg ${targetPlatform === 'android' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-900 text-slate-500'}`}>
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold block text-slate-200">Android (Termux Mobile)</span>
              <span className="text-[10px] text-slate-500 block mt-0.5 truncate">On-Device ARM64 Unpacking</span>
              <span className="inline-block mt-2 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[8.5px] font-mono rounded font-medium">
                termux-chroot ./unpackimg.sh
              </span>
            </div>
            {targetPlatform === 'android' && (
              <div className="absolute top-0 right-0 w-8 h-8 bg-emerald-500/10 rounded-bl-full flex items-center justify-center">
                <Check className="w-3 h-3 text-emerald-400 mr-1.5 mb-1.5" />
              </div>
            )}
          </button>

          {/* Windows Option */}
          <button
            type="button"
            onClick={() => {
              setTargetPlatform('windows');
              setAikConsoleLogs(prev => [
                ...prev,
                `[AIK-HOST] Target environment switched to Windows (PowerShell / CMD with Cygwin wrapper).`,
                `[AIK-HOST] Executables redirected to '.exe' binaries, with Windows backslash separators.`
              ]);
            }}
            className={`flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all relative overflow-hidden cursor-pointer ${
              targetPlatform === 'windows'
                ? 'bg-gradient-to-br from-amber-500/15 to-amber-600/5 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)] text-white'
                : 'bg-slate-950/40 border-slate-900 text-slate-400 hover:border-slate-800 hover:bg-slate-950/60'
            }`}
          >
            <div className={`p-2 rounded-lg ${targetPlatform === 'windows' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-900 text-slate-500'}`}>
              <Monitor className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold block text-slate-200">Windows Host</span>
              <span className="text-[10px] text-slate-500 block mt-0.5 truncate">PowerShell or Command Prompt</span>
              <span className="inline-block mt-2 px-1.5 py-0.5 bg-amber-500/10 text-amber-400 text-[8.5px] font-mono rounded font-medium">
                .\unpackimg.bat
              </span>
            </div>
            {targetPlatform === 'windows' && (
              <div className="absolute top-0 right-0 w-8 h-8 bg-amber-500/10 rounded-bl-full flex items-center justify-center">
                <Check className="w-3 h-3 text-amber-400 mr-1.5 mb-1.5" />
              </div>
            )}
          </button>
        </div>

        {/* Dynamic Platform Prerequisites Guide panel */}
        <div className="mt-4 p-3.5 bg-slate-900/30 border border-slate-900 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              {targetPlatform === 'linux' && "Linux Setup & Package Requirements"}
              {targetPlatform === 'android' && "Android Termux Setup & Package Requirements"}
              {targetPlatform === 'windows' && "Windows (Cygwin) Setup & Package Requirements"}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-8">
              <p className="text-[11px] text-slate-400 leading-normal">
                {targetPlatform === 'linux' && "Ensures necessary 32-bit compatibility runtimes and compression utils are installed. Execute in terminal:"}
                {targetPlatform === 'android' && "Prerequisite Termux utilities to map directories under rootless chroot or local root sandbox:"}
                {targetPlatform === 'windows' && "Cygwin emulation files are bundled under the bin/ folder. No install is required, but you must ensure path length limits are not exceeded."}
              </p>
              <div className="bg-[#050811] border border-slate-900 p-2 rounded font-mono text-[10px] mt-2 text-indigo-300 flex items-center gap-1.5 overflow-x-auto">
                <span className="text-slate-600 font-bold">$</span>
                <span>
                  {targetPlatform === 'linux' && "sudo apt-get update && sudo apt-get install -y gcc-multilib g++-multilib cpio lz4 xz-utils"}
                  {targetPlatform === 'android' && "pkg install -y termux-exec clang cpio tar root-repo && pkg install -y tsu busybox"}
                  {targetPlatform === 'windows' && "set PATH=%PATH%;C:\\AIK_Studio\\bin   :: Register binary helpers inside System Environment variables"}
                </span>
              </div>
            </div>
            <div className="md:col-span-4 flex justify-end">
              <div className="bg-[#0e1628] border border-slate-850 p-2.5 rounded-xl text-center w-full">
                <span className="text-[9px] uppercase font-bold text-slate-500 block mb-1">DOWNLOAD ARCHIVE</span>
                <button
                  type="button"
                  className="w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] transition-all flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> AIK-{targetPlatform.toUpperCase()}-v3.8.zip
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. CHOOSE SOURCE IMAGE */}
      <div className="bg-slate-950 border border-slate-900 rounded-2xl p-5 shadow-xl grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        
        {/* Template Selector */}
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1.5">1. Select Stock Image Template</label>
          <select
            value={selectedTemplateId}
            onChange={(e) => {
              setSelectedTemplateId(e.target.value);
              loadPresetTemplate(e.target.value);
            }}
            className="w-full bg-[#0a0d18] border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none"
          >
            {stockImageTemplates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} ({tpl.type.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        {/* OR upload customized image */}
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1.5">Or Upload Custom Raw `.img` file</label>
          <div className="relative">
            <input
              type="file"
              id="raw-img-uploader"
              accept=".img,.bin"
              onChange={handleCustomFileUpload}
              className="hidden"
            />
            <label 
              htmlFor="raw-img-uploader" 
              className={`flex items-center justify-between bg-[#0a0d18] border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-400 cursor-pointer hover:border-slate-700 ${
                customImageFile ? 'border-indigo-500 bg-indigo-500/5 text-slate-200' : ''
              }`}
            >
              <span className="truncate max-w-[180px]">
                {customImageFile ? customImageFile.name : 'Upload custom image...'}
              </span>
              <FolderOpen className="w-4 h-4 text-indigo-400" />
            </label>
          </div>
        </div>

        {/* Action Trigger Buttons */}
        <div className="flex gap-2">
          <button
            disabled={isUnpacking || activeStep === 'unpacked'}
            onClick={handleUnpackImage}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
              activeStep === 'unpacked'
                ? 'bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {isUnpacking ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Unpacking...
              </>
            ) : activeStep === 'unpacked' ? (
              <>
                <CheckCircle2 className="w-4 h-4" /> Unpacked Ready
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Decompose & Unpack Image
              </>
            )}
          </button>

          <button
            disabled={isRepacking || activeStep !== 'unpacked'}
            onClick={handleRepackImage}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
              activeStep !== 'unpacked'
                ? 'bg-slate-900 border border-slate-850 text-slate-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white'
            }`}
          >
            {isRepacking ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Repacking...
              </>
            ) : (
              <>
                <Hammer className="w-4 h-4" /> Repack & Sign Image
              </>
            )}
          </button>
        </div>

      </div>

      {/* 3. DOUBLE-COLUMN DEEP INTEGRATION WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* LEFT COMPONENT: IMAGE HEADERS & PRE-SET RAMDISK HACKS */}
        <div className="lg:col-span-4 space-y-6 flex flex-col justify-between">
          
          {/* HEADER STRUCTURE DETECTOR */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4.5 h-4.5 text-indigo-400" /> Image Header & Address Offsets
              </h3>
              <span className="text-[9px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.2 rounded font-bold">
                {imageType.toUpperCase()}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Boot Header Version</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 1, 2, 3, 4].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setHeaderVersion(v)}
                      className={`py-1 rounded text-xs font-mono font-bold border transition-all ${
                        headerVersion === v 
                          ? 'bg-indigo-600 border-indigo-500 text-white' 
                          : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      v{v}
                    </button>
                  ))}
                </div>
                <span className="text-[9px] text-slate-500 block mt-1">v3/v4 are standard on Android 12, 13, and 14 for vendor_boot.</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Page Size (Bytes)</label>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value={2048}>2048</option>
                    <option value={4096}>4096</option>
                    <option value={16384}>16384 (16KB Boot)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Ramdisk Compression</label>
                  <select
                    value={compression}
                    onChange={(e) => setCompression(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="gzip">gzip (Fastest)</option>
                    <option value="lz4">lz4 (AOSP Default)</option>
                    <option value="xz">xz (Maximum Compression)</option>
                    <option value="lzma">lzma</option>
                    <option value="bzip2">bzip2</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Kernel Base address</label>
                  <input
                    type="text"
                    value={kernelBase}
                    onChange={(e) => setKernelBase(e.target.value)}
                    placeholder="e.g. 0x00000000"
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Ramdisk Offset</label>
                  <input
                    type="text"
                    value={ramdiskOffset}
                    onChange={(e) => setRamdiskOffset(e.target.value)}
                    placeholder="e.g. 0x01100000"
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none"
                  />
                </div>
              </div>

              {headerVersion >= 3 && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">DTB Offset Address</label>
                  <input
                    type="text"
                    value={dtbOffset}
                    onChange={(e) => setDtbOffset(e.target.value)}
                    placeholder="e.g. 0x0f000000"
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Target OS Version</label>
                  <input
                    type="text"
                    value={osVersion}
                    onChange={(e) => setOsVersion(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Security Patch Level</label>
                  <input
                    type="text"
                    value={patchLevel}
                    onChange={(e) => setPatchLevel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Command Line String (`boot-cmdline`)</label>
                <textarea
                  value={cmdline}
                  rows={3}
                  onChange={(e) => setCmdline(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-indigo-300 focus:outline-none resize-none leading-normal"
                />
              </div>
            </div>
          </div>

          {/* ONE-CLICK DEVEL REFLSH HACKS */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex-1 mt-6">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Flame className="w-4.5 h-4.5 text-indigo-400" /> Inject Quick Developer Hacks
              </h3>
              <span className="text-[9.5px] font-mono text-indigo-400 font-bold">AOSP PATCHER</span>
            </div>

            <p className="text-xs text-slate-400 leading-normal mb-4">
              Apply structural changes inside the unpacked ramdisk configurations with a single tap. Toggle parameters on the fly:
            </p>

            <div className="space-y-3">
              {/* Hack 1 */}
              <button
                type="button"
                onClick={() => toggleHack('verity')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  dmVerityDisabled 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-800'
                }`}
              >
                <div>
                  <span className="text-xs font-bold block text-slate-200">Bypass / Strip DM-Verity Checks</span>
                  <span className="text-[10px] text-slate-500">Alters fstab flags from `verify` to `nofail` bypass.</span>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  dmVerityDisabled ? 'border-emerald-400 bg-emerald-400/20' : 'border-slate-700'
                }`}>
                  {dmVerityDisabled && <Check className="w-2.5 h-2.5" />}
                </div>
              </button>

              {/* Hack 2 */}
              <button
                type="button"
                onClick={() => toggleHack('adb')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  adbUnsecured 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-800'
                }`}
              >
                <div>
                  <span className="text-xs font-bold block text-slate-200">Force Unsecure ABD / root access</span>
                  <span className="text-[10px] text-slate-500">Injects `ro.secure=0`, `ro.debuggable=1` property overrides.</span>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  adbUnsecured ? 'border-emerald-400 bg-emerald-400/20' : 'border-slate-700'
                }`}>
                  {adbUnsecured && <Check className="w-2.5 h-2.5" />}
                </div>
              </button>

              {/* Hack 3 */}
              <button
                type="button"
                onClick={() => toggleHack('selinux')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  selinuxPermissive 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-800'
                }`}
              >
                <div>
                  <span className="text-xs font-bold block text-slate-200">Inject Permissive SELinux Kernel Flag</span>
                  <span className="text-[10px] text-slate-500">Appends `androidboot.selinux=permissive` into cmdline.</span>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  selinuxPermissive ? 'border-emerald-400 bg-emerald-400/20' : 'border-slate-700'
                }`}>
                  {selinuxPermissive && <Check className="w-2.5 h-2.5" />}
                </div>
              </button>

              {/* Hack 4 */}
              <button
                type="button"
                onClick={() => toggleHack('root')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  rootAccessInjected 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-800'
                }`}
              >
                <div>
                  <span className="text-xs font-bold block text-slate-200">Inject Mock `/sbin/su` Root Daemon</span>
                  <span className="text-[10px] text-slate-500">Registers custom daemon services triggers into `init.rc`.</span>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                  rootAccessInjected ? 'border-emerald-400 bg-emerald-400/20' : 'border-slate-700'
                }`}>
                  {rootAccessInjected && <Check className="w-2.5 h-2.5" />}
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COMPONENT: FILE SELECTION + HIGH DENSITY TEXT EDITOR + TERM LOGS */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* VIRTUAL DIRECTORY FILE EDITOR */}
          <div className="bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex-1 flex flex-col justify-between min-h-[460px]">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-900 pb-3 mb-4 gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <FolderTree className="w-4.5 h-4.5 text-indigo-400" /> Ramdisk Virtual File Explorer
                  </h3>
                  <span className="text-xs text-slate-500 block mt-0.5">Click any unpacked file to view or edit raw configurations.</span>
                </div>

                <div className="flex bg-[#0a0d18] p-1 border border-slate-900 rounded-lg max-w-[280px]">
                  <span className="text-[10px] font-mono text-slate-400 font-bold px-2 flex items-center gap-1.5">
                    <Edit3 className="w-3 h-3 text-indigo-400" /> REAL-TIME EDITOR
                  </span>
                </div>
              </div>

              {/* Grid of files and content editors */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
                
                {/* File list */}
                <div className="md:col-span-3 space-y-2">
                  <span className="text-[9px] font-bold uppercase font-mono text-slate-500 tracking-wider block">
                    Unpacked Files
                  </span>
                  <div className="space-y-1.5">
                    {ramdiskFiles.map((file, idx) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => handleSelectFile(idx)}
                        className={`w-full p-2.5 rounded-xl border text-left transition-all block cursor-pointer ${
                          selectedFileIndex === idx
                            ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 font-bold'
                            : 'bg-slate-900/50 border-slate-900/80 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-mono truncate">{file.path}</span>
                          {file.modified && (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block shrink-0" title="Modified" />
                          )}
                        </div>
                        <span className="text-[9px] text-slate-500 block truncate mt-0.5 leading-tight">
                          {file.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                 {/* Code editor pane */}
                <div className="md:col-span-9 bg-[#04060f] border border-slate-900 rounded-xl p-3 flex flex-col h-[300px]">
                  <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-2">
                    <span className="text-[10px] text-indigo-400 font-mono">
                      editing: {targetPlatform === 'windows' ? 'C:\\AIK_Studio\\ramdisk\\' : '/ramdisk/'}{ramdiskFiles[selectedFileIndex]?.path?.replace(/\//g, targetPlatform === 'windows' ? '\\' : '/') || 'init.rc'}
                    </span>
                    <span className="text-[9px] text-slate-600 font-mono">UTF-8 File Encoded</span>
                  </div>

                  <textarea
                    value={editingContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    disabled={activeStep !== 'unpacked'}
                    className="w-full bg-transparent border-0 text-xs text-indigo-200 font-mono leading-relaxed focus:outline-none resize-none flex-1"
                    placeholder={activeStep !== 'unpacked' ? '# Unpack an image template first to browse and modify file structures.' : '# Enter custom definitions here...'}
                  />
                </div>

              </div>
            </div>

            {/* FLASHER & EXPORT INSTRUCTIONS */}
            <div className="mt-5 p-3.5 bg-indigo-500/5 border border-indigo-500/10 rounded-xl flex items-start gap-3">
              <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-bold text-white block">AOSP Partition Flashing & Device Bindings:</span>
                <p className="text-[10px] text-slate-400 leading-normal mt-0.5">
                  Once your modified boot payload is compiled, write directly to your target board partitions. Select flash syntax matching your target:
                </p>
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <div className="flex-1 flex items-center gap-1.5 bg-slate-950 p-2.5 rounded-lg border border-slate-900/60 font-mono text-[10px] text-indigo-300">
                    <span className="text-slate-600 shrink-0">{targetPlatform === 'windows' ? 'C:\\>' : '$'}</span>
                    <span>
                      {targetPlatform === 'windows' 
                        ? `fastboot.exe flash ${imageType} new-${imageType}.img`
                        : `fastboot flash ${imageType} new-${imageType}.img`
                      }
                    </span>
                  </div>
                  {targetPlatform === 'android' && (
                    <div className="flex-1 flex items-center gap-1.5 bg-slate-950 p-2.5 rounded-lg border border-emerald-950/60 font-mono text-[10px] text-emerald-300">
                      <span className="text-emerald-700 shrink-0">#</span>
                      <span title="On-device direct block flash">
                        dd if=new-{imageType}.img of=/dev/block/by-name/{imageType}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* AIK INTEGRATED TERMINAL AND CONSOLE LOGS */}
          <div className="bg-[#0b0e1a] border border-slate-900 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTerminalTab('output')}
                  className={`text-[10px] font-mono uppercase tracking-wider font-extrabold px-2.5 py-1 rounded transition-all cursor-pointer ${
                    activeTerminalTab === 'output' ? 'bg-indigo-600/15 text-indigo-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  AIK Output Console
                </button>
                <button
                  onClick={() => setActiveTerminalTab('script')}
                  className={`text-[10px] font-mono uppercase tracking-wider font-extrabold px-2.5 py-1 rounded transition-all cursor-pointer ${
                    activeTerminalTab === 'script' ? 'bg-indigo-600/15 text-indigo-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Raw AIK Unpack/Repack Script Code
                </button>
              </div>

              <span className="text-[9px] text-slate-600 font-mono flex items-center gap-1">
                <Terminal className="w-3 h-3 text-indigo-400" /> HOST SHELL
              </span>
            </div>

            {activeTerminalTab === 'output' ? (
              <div className="bg-slate-950/80 rounded-xl p-3 h-[140px] overflow-y-auto scrollbar-thin border border-slate-900 font-mono text-[10.5px] leading-relaxed text-slate-300 space-y-1">
                {aikConsoleLogs.map((log, index) => (
                  <div key={index} className={
                    log.includes('[AIK-ERROR]') ? 'text-rose-400' :
                    log.includes('[AIK-PATCH]') ? 'text-indigo-400 font-bold' :
                    log.startsWith('$') || log.startsWith('C:\\') || log.includes('unpackimg.sh') || log.includes('repackimg.sh') || log.includes('unpackimg.bat') ? 'text-emerald-400 font-bold' : 'text-slate-400'
                  }>
                    {log}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-950/80 rounded-xl p-3 h-[140px] overflow-y-auto scrollbar-thin border border-slate-900 font-mono text-[10.5px] leading-relaxed text-indigo-300 space-y-2">
                <div>
                  <span className="text-slate-500 font-bold block mb-1">
                    {targetPlatform === 'windows' ? ':: unpackimg.bat Script (Windows CMD/Cygwin)' : targetPlatform === 'android' ? '# unpackimg.sh Script (Android Termux ARM64)' : '# unpackimg.sh Script (Linux x86_64)'}
                  </span>
                  <pre className="text-slate-400 text-[9.5px]">
                    {targetPlatform === 'windows' ? (
`@echo off
:: AIK - Android Image Kitchen Unpack Batch Script (Windows CMD)
:: Osm0sis @ xda-developers

setlocal
set "AIK_DIR=%~dp0"
cd /d "%AIK_DIR%"

if not exist "%AIK_DIR%bin\\cygwin1.dll" (
  echo [ERROR] Cygwin dependency dlls not found!
  exit /b 1
)

"%AIK_DIR%bin\\unpackbootimg.exe" -i "%~1" -o split_img\\
header_ver=3
echo Unpacked boot header version: %header_ver%`
                    ) : targetPlatform === 'android' ? (
`#!/data/data/com.termux/files/usr/bin/bash
# AIK - Android Image Kitchen Unpack Script (Android Termux arm64)
# Osm0sis @ xda-developers

export PATH="./bin/arm64:./bin/arm:$PATH"
chmod +x ./bin/arm64/* ./bin/arm/* 2>/dev/null

if [ ! -x "./bin/arm64/unpackbootimg" ]; then
  echo "[ERROR] Precompiled ARM64 binary is not executable!"
  exit 1
fi

./bin/arm64/unpackbootimg -i "$1" -o split_img/`
                    ) : (
`#!/bin/sh
# AIK - Android Image Kitchen Unpack Script (Linux)
# Osm0sis @ xda-developers

bin/unpackbootimg -i "$1" -o split_img/
header_ver=$(cat split_img/*-header_version)
magic_bytes=$(cat split_img/*-magic)

echo "Detected Header version: $header_ver"
if [ "$header_ver" -ge 3 ]; then
  # split boot ramdisk
  bin/mkbootimg --extract_ramdisk
fi`
                    )}
                  </pre>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 4. COMPRESSION & MEMORY ARCHITECT (EROFS & ZRAM) */}
      <div className="bg-[#0c1222] border border-slate-900 rounded-2xl p-6 shadow-2xl space-y-6" id="aik-compression-swapping-studio">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-900 pb-4 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold font-mono rounded-full flex items-center gap-1 uppercase">
                <Zap className="w-3.5 h-3.5" /> High Performance Compression
              </span>
            </div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2.5">
              <Database className="text-emerald-400 w-5 h-5" /> Kernel Compression & File System Studio
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 max-w-3xl">
              Configure system compression topologies. Assemble read-only EROFS system payloads with LZ4/ZSTD block compressions, or fine-tune kernel memory parameters by modifying ZRAM in-memory swap streams.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 bg-slate-950 p-2 rounded-lg border border-slate-900">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Active Compression Layer: v1.6-Stable
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* COLUMN 1: EROFS FILESYSTEM COMPILER */}
          <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-400" /> EROFS File System Compiler
                </h4>
                <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded text-[9px] font-mono font-bold">
                  READ-ONLY SYSTEM FS
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-normal">
                EROFS (Enhanced Read-Only File System) provides block-level compression with near-zero latency overhead. Customize the compiler options below:
              </p>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Target Partition</label>
                  <select
                    value={erofsTargetPartition}
                    onChange={(e) => setErofsTargetPartition(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="system">system.img</option>
                    <option value="vendor">vendor.img</option>
                    <option value="product">product.img</option>
                    <option value="system_ext">system_ext.img</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Block Unit Size</label>
                  <select
                    value={erofsBlockSize}
                    onChange={(e) => setErofsBlockSize(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value={4096}>4096 (Default Android)</option>
                    <option value={8192}>8192 (High Density)</option>
                    <option value={16384}>16384 (Enterprise)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Payload Source Path</label>
                <input
                  type="text"
                  value={erofsSourceDir}
                  onChange={(e) => setErofsSourceDir(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Compression Algorithm</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['lz4hc', 'lz4', 'zstd', 'none'] as const).map((alg) => (
                    <button
                      key={alg}
                      type="button"
                      onClick={() => {
                        setErofsCompressionAlg(alg);
                        if (alg === 'lz4hc') setErofsCompressionLevel(9);
                        else if (alg === 'zstd') setErofsCompressionLevel(6);
                        else setErofsCompressionLevel(1);
                      }}
                      className={`py-1.5 rounded-lg text-[11px] font-mono font-bold border transition-all ${
                        erofsCompressionAlg === alg 
                          ? 'bg-emerald-600/15 border-emerald-500 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]' 
                          : 'bg-slate-950 border-slate-900 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {alg.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {erofsCompressionAlg !== 'none' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 block">Compression Effort Level</label>
                    <span className="text-[11px] font-mono font-bold text-emerald-400">Level {erofsCompressionLevel}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={erofsCompressionAlg === 'zstd' ? 12 : 9}
                    value={erofsCompressionLevel}
                    onChange={(e) => setErofsCompressionLevel(Number(e.target.value))}
                    className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[8px] text-slate-600 font-mono mt-0.5">
                    <span>MIN EFFORT</span>
                    <span>MAX COMPRESSION</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={erofsDedupe}
                    onChange={(e) => setErofsDedupe(e.target.checked)}
                    className="mt-0.5 rounded border-slate-900 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-300 block">Deduplication (`-zdedupe`)</span>
                    <span className="text-[9px] text-slate-500 block leading-tight mt-0.5">Scans file block hashes and shares identical read-only physical storage chunks.</span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={erofsSharedBlocks}
                    onChange={(e) => setErofsSharedBlocks(e.target.checked)}
                    className="mt-0.5 rounded border-slate-900 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-300 block">Shared Blocks</span>
                    <span className="text-[9px] text-slate-500 block leading-tight mt-0.5">Enables block sharing over system.img & product.img boundaries for custom partitions.</span>
                  </div>
                </label>
              </div>

              {/* Dynamic mkfs Command Display */}
              <div className="bg-[#050812] border border-slate-900 rounded-lg p-2.5">
                <span className="text-[9px] font-mono text-slate-600 font-bold block mb-1">LIVE COMPILER CLI COMMAND:</span>
                <div className="font-mono text-[10px] text-indigo-300 overflow-x-auto whitespace-pre select-all leading-normal">
                  mkfs.erofs -z{erofsCompressionAlg}{erofsCompressionAlg !== 'none' ? `,${erofsCompressionLevel}` : ''} -C{erofsBlockSize} {erofsDedupe ? '-zdedupe ' : ''}{erofsSharedBlocks ? '--shared-blocks ' : ''}{erofsTargetPartition}.erofs.img {erofsSourceDir}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-900/60 space-y-4">
              {erofsReport && (
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  <div>
                    <span className="text-[8.5px] uppercase font-bold text-slate-500 block">Original Vol</span>
                    <span className="text-xs font-mono font-extrabold text-slate-300 block mt-0.5">{erofsReport.originalSize}</span>
                  </div>
                  <div>
                    <span className="text-[8.5px] uppercase font-bold text-slate-500 block">Comp. EROFS</span>
                    <span className="text-xs font-mono font-extrabold text-emerald-400 block mt-0.5">{erofsReport.compressedSize}</span>
                  </div>
                  <div>
                    <span className="text-[8.5px] uppercase font-bold text-slate-500 block">Reduction Ratio</span>
                    <span className="text-xs font-mono font-extrabold text-emerald-400 block mt-0.5">{erofsReport.ratio}</span>
                  </div>
                  <div>
                    <span className="text-[8.5px] uppercase font-bold text-slate-500 block">Blocks Written</span>
                    <span className="text-xs font-mono font-extrabold text-slate-300 block mt-0.5">{erofsReport.blocksWritten}</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleBuildErofs}
                disabled={isBuildingErofs}
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  isBuildingErofs 
                    ? 'bg-slate-900 text-slate-500 border border-slate-800' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-emerald-500/10'
                }`}
              >
                {isBuildingErofs ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Compressing Payload chunks into EROFS...
                  </>
                ) : (
                  <>
                    <HardDrive className="w-4 h-4" /> Simulate EROFS Partition Compilation
                  </>
                )}
              </button>
            </div>
          </div>

          {/* COLUMN 2: ZRAM & KERNEL MEMORY TUNER */}
          <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" /> ZRAM Swapping & Memory Optimizer
                </h4>
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-[9px] font-mono font-bold">
                  RAM SWAP TUNER
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-normal">
                ZRAM creates a compressed swap space in RAM. Slower read/write pages are dynamically compressed to increase active system capacity on demand. Modify ZRAM and kernel memory mappings:
              </p>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Compression Algorithm</label>
                  <select
                    value={zramCompressionAlg}
                    onChange={(e) => setZramCompressionAlg(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono"
                  >
                    <option value="zstd">ZSTD (Fastest, High Ratio)</option>
                    <option value="lz4">LZ4 (Extremely Low Latency)</option>
                    <option value="lzo-rle">LZO-RLE (AOSP Default)</option>
                    <option value="lzo">LZO (Legacy Standard)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] uppercase font-bold text-slate-500 block">Swap Memory Pool Sizing</label>
                    <span className="text-[10px] font-mono font-bold text-emerald-400">{(zramSizeMb/1024).toFixed(1)} GB</span>
                  </div>
                  <select
                    value={zramSizeMb}
                    onChange={(e) => setZramSizeMb(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value={1024}>1.0 GB Swap (Low Memory Target)</option>
                    <option value={2048}>2.0 GB Swap (Standard Device)</option>
                    <option value={4096}>4.0 GB Swap (Performance Config)</option>
                    <option value={6144}>6.0 GB Swap (Heavy Gaming/AI Profiling)</option>
                    <option value={8192}>8.1 GB Swap (Virtual Machine/Workstation)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 block">Comp. Stream Limit</label>
                    <span className="text-[11px] font-mono font-bold text-slate-300">{zramMaxStreams} Cores</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={16}
                    value={zramMaxStreams}
                    onChange={(e) => setZramMaxStreams(Number(e.target.value))}
                    className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[8px] text-slate-600 font-mono mt-0.5">
                    <span>1 CORE</span>
                    <span>16 CORES</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 block">VM Swappiness Rating</label>
                    <span className="text-[11px] font-mono font-bold text-slate-300">{zramSwappiness}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={zramSwappiness}
                    onChange={(e) => setZramSwappiness(Number(e.target.value))}
                    className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[8px] text-slate-600 font-mono mt-0.5">
                    <span>0 (LAZY)</span>
                    <span>200 (AGGRESSIVE)</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-900/60 pt-3 space-y-3.5">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={zramWritebackEnabled}
                    onChange={(e) => setZramWritebackEnabled(e.target.checked)}
                    className="mt-0.5 rounded border-slate-900 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-300 block">Enable ZRAM Physical Writeback Backing Device</span>
                    <span className="text-[9px] text-slate-500 block leading-tight mt-0.5">Permits idle compressed memory pages to be archived into flash storage, protecting systems from sudden Out-Of-Memory thrashing.</span>
                  </div>
                </label>

                {zramWritebackEnabled && (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Writeback Partition Path</label>
                    <input
                      type="text"
                      value={zramBackingDevice}
                      onChange={(e) => setZramBackingDevice(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-indigo-300 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-900/60 space-y-3">
              {zramInjected && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2.5">
                  <Check className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">ZRAM Configuration Injected!</span>
                    <span className="text-[10px] text-slate-400 leading-none">Modified 3 source files inside ramdisk Virtual Explorer (`init.rc`, `fstab`, `default.prop`).</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleInjectZram}
                  disabled={activeStep !== 'unpacked'}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    activeStep !== 'unpacked'
                      ? 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg'
                  }`}
                >
                  <Database className="w-4 h-4" /> Inject ZRAM Configuration to active Ramdisk
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* 5. LOCAL MODEL OPTIMIZER & AGENT CO-PILOT (OLLAMA & LLAMA) */}
      <div className="bg-[#0c1222] border border-slate-900 rounded-2xl p-6 shadow-2xl space-y-6" id="aik-local-ai-copilot">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-900 pb-4 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[11px] font-bold font-mono rounded-full flex items-center gap-1 uppercase">
                <Sparkles className="w-3.5 h-3.5" /> Local Agent Co-Pilot
              </span>
            </div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2.5">
              <Cpu className="text-indigo-400 w-5 h-5" /> Local Llama & Ollama AI Optimizer
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 max-w-3xl">
              Connect to your locally running Ollama instance or use the Local Agent Simulator. Get live code patches, memory layout optimizations, and direct advice on AOSP Ramdisk compiling.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setUseOllamaServer(!useOllamaServer)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                useOllamaServer
                  ? 'bg-emerald-600/10 border-emerald-500 text-emerald-400'
                  : 'bg-indigo-600/10 border-indigo-500/30 text-indigo-300'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Mode: {useOllamaServer ? 'Real Ollama Endpoint' : 'Local Agent Simulator'}
            </button>
            
            <button
              type="button"
              onClick={() => setShowCorsHelp(!showCorsHelp)}
              className="px-3 py-1.5 bg-slate-950 border border-slate-900 text-slate-400 hover:text-slate-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5" />
              CORS / Setup Help
            </button>
          </div>
        </div>

        {/* CORS Help Alert */}
        {showCorsHelp && (
          <div className="bg-slate-950 border border-indigo-500/20 rounded-xl p-5 space-y-3 font-mono text-[11px] text-slate-300 leading-relaxed">
            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
              <span className="text-indigo-400 font-bold uppercase flex items-center gap-2">
                <Settings className="w-4 h-4" /> Setup Instructions for Local Ollama Connection
              </span>
              <button 
                type="button" 
                onClick={() => setShowCorsHelp(false)}
                className="text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                [Dismiss]
              </button>
            </div>
            <p>
              To allow this web browser application to securely communicate with Ollama running on your local computer, you must run it with CORS headers enabled. Run the following command according to your system:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-900">
                <span className="text-xs font-bold text-white block mb-1">Linux Command:</span>
                <pre className="text-emerald-400 bg-black/40 p-2 rounded text-[10px] whitespace-pre-wrap select-all">
                  OLLAMA_ORIGINS="*" ollama serve
                </pre>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-900">
                <span className="text-xs font-bold text-white block mb-1">macOS Terminal:</span>
                <pre className="text-emerald-400 bg-black/40 p-2 rounded text-[10px] whitespace-pre-wrap select-all">
                  launchctl setenv OLLAMA_ORIGINS "*"
                  # (Then restart Ollama tray app)
                </pre>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-900">
                <span className="text-xs font-bold text-white block mb-1">Windows Powershell:</span>
                <pre className="text-emerald-400 bg-black/40 p-2 rounded text-[10px] whitespace-pre-wrap select-all">
                  $env:OLLAMA_ORIGINS="*"
                  ollama serve
                </pre>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: CONTROL & PRESET SHORTCUTS (4 cols) */}
          <div className="lg:col-span-4 bg-slate-950/40 border border-slate-900 rounded-xl p-5 flex flex-col justify-between space-y-5">
            
            <div className="space-y-4">
              <div className="border-b border-slate-900 pb-2">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Settings className="w-4 h-4 text-indigo-400" /> Copilot Configurations
                </h4>
              </div>

              {/* Endpoint Address */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Ollama Server Endpoint</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ollamaEndpoint}
                    onChange={(e) => setOllamaEndpoint(e.target.value)}
                    placeholder="http://localhost:11434"
                    disabled={!useOllamaServer}
                    className="flex-1 bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleTestOllamaConnection()}
                    disabled={!useOllamaServer || ollamaStatus === 'testing'}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900 disabled:text-slate-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap"
                  >
                    {ollamaStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>

              {/* Status Banner */}
              <div className="p-3 bg-slate-950 border border-slate-900 rounded-lg flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">Endpoint Connection:</span>
                {ollamaStatus === 'connected' && useOllamaServer ? (
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded text-[9px] font-bold font-mono">
                    CONNECTED
                  </span>
                ) : ollamaStatus === 'error' && useOllamaServer ? (
                  <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded text-[9px] font-bold font-mono">
                    OFFLINE / BLOCKED
                  </span>
                ) : ollamaStatus === 'testing' ? (
                  <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-bold font-mono animate-pulse">
                    PROBING...
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-bold font-mono">
                    SIMULATOR ACTIVE
                  </span>
                )}
              </div>

              {/* Model Select */}
              <div className="grid grid-cols-1 gap-3.5">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Target Model Name</label>
                  <select
                    value={selectedOllamaModel}
                    onChange={(e) => setSelectedOllamaModel(e.target.value)}
                    disabled={!useOllamaServer}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 disabled:opacity-50 cursor-pointer font-mono"
                  >
                    {availableModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="custom">-- Custom local model --</option>
                  </select>
                </div>

                {selectedOllamaModel === 'custom' && (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Enter Custom Model Identifier</label>
                    <input
                      type="text"
                      value={customOllamaModel}
                      onChange={(e) => setCustomOllamaModel(e.target.value)}
                      placeholder="llama3.1:8b-instruct-q4_K_M"
                      className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Preset AI Triggers */}
              <div className="pt-2">
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-2">Preset Agent Task Accelerators</label>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleSendAiMessage("Suggest high-performance fstab.hardware optimization parameters specifically targeting the F2FS block mapping caches for my ramdisk.")}
                    disabled={aiChatLoading}
                    className="w-full p-2.5 bg-slate-950 border border-slate-900 hover:border-indigo-500/40 text-left rounded-lg text-xs text-slate-300 hover:text-white transition-all cursor-pointer flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                      Optimize fstab & Ramdisk
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSendAiMessage("Formulate customized ZRAM configurations and optimal vm swappiness kernel init triggers to maximize multitask responsiveness.")}
                    disabled={aiChatLoading}
                    className="w-full p-2.5 bg-slate-950 border border-slate-900 hover:border-indigo-500/40 text-left rounded-lg text-xs text-slate-300 hover:text-white transition-all cursor-pointer flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                      Tuning Swappiness & ZRAM
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSendAiMessage("Provide an in-depth architectural breakdown on configuring EROFS with LZ4 versus ZSTD block structures for system read-only images.")}
                    disabled={aiChatLoading}
                    className="w-full p-2.5 bg-slate-950 border border-slate-900 hover:border-indigo-500/40 text-left rounded-lg text-xs text-slate-300 hover:text-white transition-all cursor-pointer flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Database className="w-3.5 h-3.5 text-rose-400" />
                      EROFS Compression Advisor
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  </button>
                </div>
              </div>

            </div>

            <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl flex gap-2.5 text-[10px] text-slate-400 leading-normal">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                <strong>How it works:</strong> All transactions are executed locally on your web host loopback port. No telemetry or server keys are sent outside your local perimeter.
              </span>
            </div>

          </div>

          {/* RIGHT COLUMN: INTERACTIVE CHAT SCREEN (8 cols) */}
          <div className="lg:col-span-8 bg-slate-950/40 border border-slate-900 rounded-xl p-5 flex flex-col h-[480px] justify-between">
            
            {/* CHAT BUBBLES WINDOW */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin scroll-smooth mb-4 min-h-[340px]">
              {aiChatHistory.map((msg, index) => (
                <div key={index} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  
                  {/* Speaker Label */}
                  <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500 mb-1 px-1.5">
                    <span className="font-bold text-slate-400">{msg.role === 'user' ? 'YOU' : 'LOCAL AGENT'}</span>
                    <span>•</span>
                    <span>{msg.timestamp}</span>
                    <span>•</span>
                    <span className="text-indigo-400">{msg.model}</span>
                  </div>

                  {/* Message Bubble */}
                  <div className={`p-4 rounded-xl text-xs max-w-[85%] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-none'
                      : 'bg-[#060810] border border-slate-900 text-slate-300 rounded-tl-none whitespace-pre-wrap font-sans'
                  }`}>
                    {/* Render helper headers for beautiful presentation inside bubbles */}
                    {msg.content.split('\n').map((line, lidx) => {
                      if (line.startsWith('### ')) {
                        return <h4 key={lidx} className="text-sm font-bold text-white mt-3 mb-1">{line.replace('### ', '')}</h4>;
                      } else if (line.startsWith('#### ')) {
                        return <h5 key={lidx} className="text-xs font-bold text-slate-200 mt-2 mb-1 uppercase tracking-wider">{line.replace('#### ', '')}</h5>;
                      } else if (line.startsWith('- ')) {
                        return <li key={lidx} className="ml-3 list-disc my-0.5">{line.replace('- ', '')}</li>;
                      } else if (line.startsWith('`') && line.endsWith('`')) {
                        return <code key={lidx} className="px-1.5 py-0.5 bg-slate-950 border border-slate-900 rounded font-mono text-[10px] text-indigo-300">{line.replace(/`/g, '')}</code>;
                      } else if (line.includes('```')) {
                        // Skip raw codeblock tokens as we render code sections
                        return null;
                      }
                      return <p key={lidx} className="my-1">{line}</p>;
                    })}

                    {/* Virtual Optimizer Patch button */}
                    {msg.isVirtualPatch && msg.patchDetails && (
                      <div className="mt-4 pt-3.5 border-t border-slate-900 flex flex-col gap-2">
                        <span className="text-[10px] text-emerald-400 font-mono font-bold flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" /> Dynamic Patch Generation Confirmed!
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleApplyVirtualPatch(msg.patchDetails!)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <Database className="w-3.5 h-3.5" />
                            Apply Optimizer Patches to Ramdisk
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => {
                              let summary = '';
                              if (msg.patchDetails?.fstabPatch) summary += `--- FSTAB ---\n${msg.patchDetails.fstabPatch}\n`;
                              if (msg.patchDetails?.propPatch) summary += `--- PROPERTIES ---\n${msg.patchDetails.propPatch}\n`;
                              if (msg.patchDetails?.initPatch) summary += `--- INIT.RC ---\n${msg.patchDetails.initPatch}\n`;
                              navigator.clipboard.writeText(summary);
                              setAikConsoleLogs(prev => [...prev, `[AIK-OLLAMA] Copied generated AI patch scripts to clipboard.`]);
                            }}
                            className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Copy Patch Scripts
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              ))}

              {/* Chat Loading State */}
              {aiChatLoading && (
                <div className="flex flex-col items-start animate-pulse">
                  <div className="flex items-center gap-1 text-[9px] font-mono text-slate-500 mb-1 px-1.5">
                    <span>LOCAL AGENT THINKING...</span>
                  </div>
                  <div className="p-4 rounded-xl bg-[#060810] border border-slate-900 text-slate-500 text-xs rounded-tl-none w-[50%] space-y-2">
                    <div className="h-2 bg-slate-900 rounded w-full" />
                    <div className="h-2 bg-slate-900 rounded w-[80%]" />
                    <div className="h-2 bg-slate-900 rounded w-[90%]" />
                  </div>
                </div>
              )}
            </div>

            {/* SEND INPUT FORM */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendAiMessage();
              }}
              className="flex gap-2.5 border-t border-slate-900/60 pt-3"
            >
              <input
                type="text"
                value={aiChatInput}
                onChange={(e) => setAiChatInput(e.target.value)}
                placeholder={useOllamaServer ? `Prompt local Ollama model...` : `Prompt simulated Llama optimizer... (e.g., 'optimize fstab')`}
                disabled={aiChatLoading}
                className="flex-1 bg-slate-950 border border-slate-900 rounded-xl p-3 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={aiChatLoading || !aiChatInput.trim()}
                className="px-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900 disabled:text-slate-600 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${aiChatLoading ? 'animate-spin' : ''}`} />
                Analyze
              </button>
            </form>

          </div>

        </div>

      </div>

    </div>
  );
}
