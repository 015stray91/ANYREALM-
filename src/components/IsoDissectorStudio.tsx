/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Compass, 
  Database, 
  FileCode, 
  FolderOpen, 
  FolderTree, 
  HardDrive, 
  Layers, 
  Cpu, 
  RefreshCw, 
  Terminal, 
  Play, 
  Save, 
  Sliders, 
  Sparkles, 
  Wrench, 
  FileCheck, 
  Download, 
  AlertTriangle, 
  Plus, 
  Trash2, 
  ChevronRight, 
  Settings, 
  Code, 
  ShieldAlert, 
  Info,
  Copy,
  FolderSync
} from 'lucide-react';

interface FileSystemProfile {
  id: 'ext2' | 'ext3' | 'ext4' | 'ntfs' | 'exfat' | 'fat32' | 'f2fs' | 'erofs';
  name: string;
  creator: 'GNU/Linux Open-Source' | 'Microsoft Proprietary' | 'Samsung Electronics' | 'Huawei / AOSP';
  description: string;
  isReadOnly: boolean;
  blockSizes: number[]; // in bytes
  compressionSupported: boolean;
}

interface IsoPayloadNode {
  name: string;
  type: 'file' | 'directory';
  size: string;
  path: string;
  contentType: string;
  children?: IsoPayloadNode[];
}

export default function IsoDissectorStudio() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'fs_matrix' | 'iso_dissector' | 'chroot_customizer'>('fs_matrix');

  // ----------------------------------------------------
  // 1. FILE SYSTEM MATRIX STATE
  // ----------------------------------------------------
  const fsProfiles: FileSystemProfile[] = [
    { id: 'ext2', name: 'EXT2 (Second Extended FS)', creator: 'GNU/Linux Open-Source', description: 'Legacy Linux file system without journaling. Fast but susceptible to corruption on sudden power failures.', isReadOnly: false, blockSizes: [1024, 2048, 4096], compressionSupported: false },
    { id: 'ext3', name: 'EXT3 (Third Extended FS)', creator: 'GNU/Linux Open-Source', description: 'Introduces a journaling transaction layer to prevent block-level corruption on sudden reboots.', isReadOnly: false, blockSizes: [1024, 2048, 4096], compressionSupported: false },
    { id: 'ext4', name: 'EXT4 (Fourth Extended FS)', creator: 'GNU/Linux Open-Source', description: 'Standard high-perf system storage on Android & Linux. Supports extents, delayed allocation, and unlimited subdirectories.', isReadOnly: false, blockSizes: [1024, 2048, 4096, 8192], compressionSupported: false },
    { id: 'ntfs', name: 'NTFS (New Technology FS)', creator: 'Microsoft Proprietary', description: 'Standard modern Microsoft Windows storage. Fully supports transactional security permissions and alternate data streams (ADS).', isReadOnly: false, blockSizes: [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536], compressionSupported: true },
    { id: 'exfat', name: 'exFAT (Extended FAT)', creator: 'Microsoft Proprietary', description: 'Lightweight format optimized for modern USB flash memory and high-capacity micro-SD cards without heavy system overhead.', isReadOnly: false, blockSizes: [512, 1024, 2048, 4096, 16384, 32768, 131072, 262144, 524288], compressionSupported: false },
    { id: 'fat32', name: 'FAT32 (File Allocation Table)', creator: 'Microsoft Proprietary', description: 'Maximum universal compatibility. Supports legacy systems and UEFI boot sectors. Subject to a strict 4GB single-file size limit.', isReadOnly: false, blockSizes: [512, 1024, 2048, 4096, 8192, 16384, 32768], compressionSupported: false },
    { id: 'f2fs', name: 'F2FS (Flash Friendly FS)', creator: 'Samsung Electronics', description: 'Specifically engineered for NAND flash controllers (NVM/SSD/UFS). Focuses on write-wear reduction and dual-head allocation.', isReadOnly: false, blockSizes: [4096], compressionSupported: true },
    { id: 'erofs', name: 'EROFS (Enhanced Read-Only FS)', creator: 'Huawei / AOSP', description: 'Ultra-compressed read-only format used in modern Android partitions. Guarantees near-zero metadata overhead and extreme read speeds.', isReadOnly: true, blockSizes: [4096], compressionSupported: true }
  ];

  const [selectedFsId, setSelectedFsId] = useState<'ext2' | 'ext3' | 'ext4' | 'ntfs' | 'exfat' | 'fat32' | 'f2fs' | 'erofs'>('ext4');
  const [selectedBlockSize, setSelectedBlockSize] = useState<number>(4096);
  
  // Custom FS Tweak sliders
  const [erofsCompressionAlgo, setErofsCompressionAlgo] = useState<'lz4' | 'lz4hc' | 'zstd'>('lz4hc');
  const [erofsCompressionLevel, setErofsCompressionLevel] = useState<number>(9);
  const [extJournalMode, setExtJournalMode] = useState<'ordered' | 'journal' | 'writeback'>('ordered');
  const [f2fsOverprovision, setF2fsOverprovision] = useState<number>(5);
  const [f2fsWearLeveling, setF2fsWearLeveling] = useState<boolean>(true);
  const [fatReservedSectors, setFatReservedSectors] = useState<number>(32);
  const [ntfsEnableCompression, setNtfsEnableCompression] = useState<boolean>(false);

  // Auto generated mkfs commands
  const [generatedMkfsCmd, setGeneratedMkfsCmd] = useState<string>('');

  const currentProfile = fsProfiles.find(f => f.id === selectedFsId)!;

  // Sync block size selection if profile changes
  useEffect(() => {
    if (!currentProfile.blockSizes.includes(selectedBlockSize)) {
      setSelectedBlockSize(currentProfile.blockSizes[0]);
    }
  }, [selectedFsId]);

  // Command Generator Effect
  useEffect(() => {
    let cmd = '';
    const devPath = '/dev/block/by-name/super_system';

    switch (selectedFsId) {
      case 'ext2':
        cmd = `mke2fs -b ${selectedBlockSize} -O ^has_journal -v ${devPath}`;
        break;
      case 'ext3':
        cmd = `mkfs.ext3 -b ${selectedBlockSize} -J size=128 -O journal_dev -o ${extJournalMode} ${devPath}`;
        break;
      case 'ext4':
        cmd = `mkfs.ext4 -b ${selectedBlockSize} -O extents,uninit_bg,dir_index -o ${extJournalMode} -m 1 ${devPath}`;
        break;
      case 'ntfs':
        cmd = `mkfs.ntfs -c ${selectedBlockSize} ${ntfsEnableCompression ? '-C' : ''} -Q -v ${devPath}`;
        break;
      case 'exfat':
        cmd = `mkfs.exfat -s ${selectedBlockSize} -b ${selectedBlockSize} -v ${devPath}`;
        break;
      case 'fat32':
        cmd = `mkfs.vfat -F 32 -s ${selectedBlockSize / 512} -R ${fatReservedSectors} ${devPath}`;
        break;
      case 'f2fs':
        cmd = `mkfs.f2fs -a 1 -o ${f2fsOverprovision} -s ${f2fsWearLeveling ? '1' : '0'} ${currentProfile.compressionSupported ? '-O extra_attr,compression' : ''} ${devPath}`;
        break;
      case 'erofs':
        cmd = `mkfs.erofs -z ${erofsCompressionAlgo},${erofsCompressionLevel} -b ${selectedBlockSize} -T 0 ./out/system.img ./system_rootfs/`;
        break;
    }
    setGeneratedMkfsCmd(cmd);
  }, [selectedFsId, selectedBlockSize, erofsCompressionAlgo, erofsCompressionLevel, extJournalMode, f2fsOverprovision, f2fsWearLeveling, fatReservedSectors, ntfsEnableCompression]);

  // ----------------------------------------------------
  // 2. ISO DISSECTOR STATE (Cubic UI lookalike)
  // ----------------------------------------------------
  const [selectedIsoName, setSelectedIsoName] = useState<string>('ubuntu-24.04-aosp-hybrid-amd64.iso');
  const [isoSize, setIsoSize] = useState<string>('3.82 GB');
  const [isDissecting, setIsDissecting] = useState<boolean>(false);
  const [isDissected, setIsDissected] = useState<boolean>(false);
  const [dissectionProgress, setDissectionProgress] = useState<number>(0);
  const [dissectorLogs, setDissectorLogs] = useState<string[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({ '/': true });

  const [virtualIsoTree, setVirtualIsoTree] = useState<IsoPayloadNode>({
    name: '/',
    type: 'directory',
    size: '3.82 GB',
    path: '/',
    contentType: 'inode/directory',
    children: [
      {
        name: 'EFI',
        type: 'directory',
        size: '12 MB',
        path: '/EFI',
        contentType: 'inode/directory',
        children: [
          { name: 'BOOT', type: 'directory', size: '12 MB', path: '/EFI/BOOT', contentType: 'inode/directory', children: [
            { name: 'BOOTX64.EFI', type: 'file', size: '1.4 MB', path: '/EFI/BOOT/BOOTX64.EFI', contentType: 'application/octet-stream' },
            { name: 'grubx64.efi', type: 'file', size: '1.8 MB', path: '/EFI/BOOT/grubx64.efi', contentType: 'application/octet-stream' }
          ]}
        ]
      },
      {
        name: 'boot',
        type: 'directory',
        size: '185 MB',
        path: '/boot',
        contentType: 'inode/directory',
        children: [
          { name: 'vmlinuz-6.8-generic', type: 'file', size: '14.2 MB', path: '/boot/vmlinuz-6.8-generic', contentType: 'application/x-executable' },
          { name: 'initrd.img-6.8-generic', type: 'file', size: '68.5 MB', path: '/boot/initrd.img-6.8-generic', contentType: 'application/x-sharedlib' },
          { name: 'grub', type: 'directory', size: '2 MB', path: '/boot/grub', contentType: 'inode/directory', children: [
            { name: 'grub.cfg', type: 'file', size: '4.8 KB', path: '/boot/grub/grub.cfg', contentType: 'text/plain' }
          ]}
        ]
      },
      {
        name: 'casper',
        type: 'directory',
        size: '3.42 GB',
        path: '/casper',
        contentType: 'inode/directory',
        children: [
          { name: 'filesystem.squashfs', type: 'file', size: '3.38 GB', path: '/casper/filesystem.squashfs', contentType: 'application/x-squashfs' },
          { name: 'filesystem.manifest', type: 'file', size: '420 KB', path: '/casper/filesystem.manifest', contentType: 'text/plain' }
        ]
      },
      {
        name: 'install',
        type: 'directory',
        size: '48 MB',
        path: '/install',
        contentType: 'inode/directory',
        children: [
          { name: 'initrd.gz', type: 'file', size: '24 MB', path: '/install/initrd.gz', contentType: 'application/gzip' },
          { name: 'vmlinuz', type: 'file', size: '12 MB', path: '/install/vmlinuz', contentType: 'application/x-executable' }
        ]
      },
      { name: 'md5sum.txt', type: 'file', size: '220 KB', path: '/md5sum.txt', contentType: 'text/plain' },
      { name: 'isolinux.bin', type: 'file', size: '24 KB', path: '/isolinux.bin', contentType: 'application/octet-stream' }
    ]
  });

  const [selectedFileNode, setSelectedFileNode] = useState<IsoPayloadNode | null>(null);
  const [fileEditorContent, setFileEditorContent] = useState<string>('');
  const [editorCopyFeedback, setEditorCopyFeedback] = useState<boolean>(false);

  // Executing the extraction pipeline simulation
  const handleTriggerDissection = () => {
    if (isDissecting) return;
    setIsDissecting(true);
    setIsDissected(false);
    setDissectionProgress(0);
    setDissectorLogs([]);

    const steps = [
      `[*] Validating targets: '${selectedIsoName}' layout integrity...`,
      `[+] ISO contains standard El-Torito boot records and UEFI EFI system partition.`,
      `[*] Mounting hybrid ISO system sector on loopback device...`,
      `[+] mount -o loop,ro ${selectedIsoName} /mnt/iso_mount_point/`,
      `[*] Dissecting ISO sectors. Copying master metadata files...`,
      `[*] Phase 1: Unpacking boot sectors / EFI binaries...`,
      `[*] Phase 2: Uncompressing squashfs root payload (unsquashfs Caspers filesystem.squashfs)...`,
      `[unsquashfs] Extracting squashfs tree block-by-block using multi-thread LZ4 compressors...`,
      `[unsquashfs] Extracted: 52,140 inodes, 8,240 symbolic links, 21 device nodes mapped.`,
      `[*] Phase 3: Mirroring core configuration nodes to writable chroot workspace...`,
      `[SUCCESS] ISO Dissection complete! Core OS root filesystem extracted cleanly inside ./squashfs-root/`,
      `[+] Host chroot directory locked. Virtual terminal emulator is primed for edits!`
    ];

    steps.forEach((step, index) => {
      setTimeout(() => {
        setDissectionProgress(Math.round(((index + 1) / steps.length) * 100));
        setDissectorLogs(prev => [...prev, step]);
        if (index === steps.length - 1) {
          setIsDissecting(false);
          setIsDissected(true);
        }
      }, (index + 1) * 350);
    });
  };

  // Toggle tree nodes expansion
  const toggleNode = (path: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  // Node selection inside tree
  const handleSelectNode = (node: IsoPayloadNode) => {
    if (node.type === 'file') {
      setSelectedFileNode(node);
      if (node.name === 'grub.cfg') {
        setFileEditorContent(
          `if [ \${recordfail} = 1 ]; then\n` +
          `  set timeout=0\n` +
          `else\n` +
          `  if [ x$feature_default_font_path = xy ] ; then\n` +
          `    set timeout=10\n` +
          `  else\n` +
          `    set timeout=5\n` +
          `  fi\n` +
          `fi\n\n` +
          `menuentry "AOSP GSI Dynamic Recovery Studio Live Desktop" --class generic {\n` +
          `  set gfxpayload=keep\n` +
          `  linux /casper/vmlinuz boot=casper quiet splash nomodeset systemd.unified_cgroup_hierarchy=0 --\n` +
          `  initrd /casper/initrd.lz\n` +
          `}`
        );
      } else if (node.name === 'filesystem.manifest') {
        setFileEditorContent(
          `gcc-13-base 13.2.0-23ubuntu4\n` +
          `git 1:2.43.0-1ubuntu7\n` +
          `erofs-utils 1.7.1-1\n` +
          `lpmake 10.0.0_r36\n` +
          `mkfs.f2fs 1.16.0-1\n` +
          `xorriso 1.5.6-1.1\n` +
          `systemd 255.4-1ubuntu8\n` +
          `pulseaudio 1:16.1+dfsg1-2ubuntu10`
        );
      } else {
        setFileEditorContent(`// Binary stream metadata of [${node.name}]\n// Size: ${node.size}\n// Binary blocks structurally protected.`);
      }
    }
  };

  // Render tree node recursive
  const renderTree = (node: IsoPayloadNode) => {
    const isExpanded = expandedNodes[node.path];
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path} className="text-xs font-mono select-none">
        <div 
          onClick={() => {
            if (node.type === 'directory') toggleNode(node.path);
            handleSelectNode(node);
          }}
          className={`flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer hover:bg-indigo-500/10 hover:text-white transition-all ${
            selectedFileNode?.path === node.path ? 'bg-indigo-600/25 text-white font-bold border-l-2 border-indigo-500' : 'text-slate-400'
          }`}
        >
          {node.type === 'directory' ? (
            <span className="text-slate-500 font-bold w-4 h-4 flex items-center justify-center font-sans">
              {isExpanded ? '▼' : '►'}
            </span>
          ) : (
            <span className="w-4" />
          )}

          <span className="shrink-0">
            {node.type === 'directory' ? (
              <FolderTree className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            ) : (
              <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </span>

          <span className="truncate flex-1">{node.name}</span>
          <span className="text-[9.5px] text-slate-600 font-mono shrink-0">{node.size}</span>
        </div>

        {node.type === 'directory' && isExpanded && hasChildren && (
          <div className="pl-4 border-l border-slate-900/80 ml-2 mt-0.5 space-y-0.5">
            {node.children!.map(child => renderTree(child))}
          </div>
        )}
      </div>
    );
  };

  // ----------------------------------------------------
  // 3. CHROOT CUSTOMIZER STATE
  // ----------------------------------------------------
  const [chrootTerminalLogs, setChrootTerminalLogs] = useState<string[]>([
    `[root@cubic-host /]# apt-get install -y erofs-utils android-sdk-libutils`,
    `Reading package lists... Done`,
    `The following NEW packages will be installed:`,
    `  erofs-utils android-sdk-libutils liblz4-tool`,
    `0 upgraded, 3 newly installed, 0 to remove.`,
    `Setting up erofs-utils (1.7.1-1)...`,
    `[root@cubic-host /]# echo "AOSP Core Dissector Prime ready" > /etc/os-release_studio`
  ]);
  const [chrootInputCmd, setChrootInputCmd] = useState<string>('');
  const [installedPackages, setInstalledPackages] = useState<string[]>([
    'gcc-aarch64-linux-gnu', 'g++', 'ccache', 'git', 'erofs-utils', 'android-sdk-libutils'
  ]);
  const [newPackageInput, setNewPackageInput] = useState<string>('');

  const handleSendChrootCmd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chrootInputCmd.trim()) return;

    const cmd = chrootInputCmd.trim();
    setChrootTerminalLogs(prev => [...prev, `[root@cubic-host /]# ${cmd}`]);

    setTimeout(() => {
      if (cmd.startsWith('apt install') || cmd.startsWith('apt-get install')) {
        const pkg = cmd.split(' ').slice(-1)[0];
        setInstalledPackages(prev => [...prev, pkg]);
        setChrootTerminalLogs(prev => [
          ...prev,
          `Reading package lists... Done`,
          `Building dependency tree... Done`,
          `Selected package ${pkg} for custom dynamic system root.`,
          `Successfully installed ${pkg} and updated system.manifest overlay.`,
          `[root@cubic-host /]#`
        ]);
      } else if (cmd === 'clear') {
        setChrootTerminalLogs([]);
      } else {
        setChrootTerminalLogs(prev => [
          ...prev,
          `Executing: parsing target system structures.`,
          `Command run successfully under sandboxed chroot container.`,
          `[root@cubic-host /]#`
        ]);
      }
    }, 500);

    setChrootInputCmd('');
  };

  // Repackage ISO simulation
  const [isRepackaging, setIsRepackaging] = useState<boolean>(false);
  const [repackagedIsoDetails, setRepackagedIsoDetails] = useState<{ name: string; size: string; hash: string } | null>(null);

  const handleRepackageIso = () => {
    setIsRepackaging(true);
    setRepackagedIsoDetails(null);

    setTimeout(() => {
      setIsRepackaging(false);
      setRepackagedIsoDetails({
        name: `custom_studio_distribution_${new Date().toISOString().slice(0,10)}.iso`,
        size: '3.91 GB',
        hash: 'SHA256: 9F:C8:D2:E3:44:A1:00:2B:EE:7C:F9:8E:D1:D0:A2:CC'
      });
    }, 2000);
  };

  const copyToClipboardText = (text: string) => {
    navigator.clipboard.writeText(text);
    setEditorCopyFeedback(true);
    setTimeout(() => setEditorCopyFeedback(false), 2000);
  };

  // Cubic/xorriso pack script
  const compiledXorrisoCode = `# Automatically generated OS packaging payload\n` +
    `# Combines modified squashfs-root back into dynamic bootloader structure\n\n` +
    `# 1. Compress custom chroot files root into Squashfs read-only block\n` +
    `mksquashfs ./squashfs-root ./casper/filesystem.squashfs -comp xz -b 1048576 -no-recovery\n\n` +
    `# 2. Update MD5 dynamic partition verification hashes\n` +
    `find . -type f -not -name "md5sum.txt" -not -path "./isolinux/*" -print0 | xargs -0 md5sum > md5sum.txt\n\n` +
    `# 3. Create ISO Hybrid image boot sector table (xorriso/isohybrid compatible)\n` +
    `xorriso -as mkisofs \\\n` +
    `  -r -V "AOSP_CUSTOM_STUDIO" \\\n` +
    `  -o ./dist/custom_distribution.iso \\\n` +
    `  -J -joliet-long \\\n` +
    `  -b isolinux/isolinux.bin \\\n` +
    `  -c isolinux/boot.cat \\\n` +
    `  -no-emul-boot -boot-load-size 4 -boot-info-table \\\n` +
    `  -eltorito-alt-boot \\\n` +
    `  -e boot/grub/efi.img \\\n` +
    `  -no-emul-boot -isohybrid-gpt-basdat \\\n` +
    `  ./extracted-iso-tree-root/`;

  return (
    <div className="flex flex-col gap-8" id="iso-dissector-fs-matrix-workspace">
      
      {/* HEADER SECTION */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <HardDrive className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 animate-pulse" /> OS System Assembler
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <HardDrive className="text-indigo-500 w-7 h-7" /> FS-Matrix & ISO Dissector Studio
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Dissect hybrid system ISO images, inspect raw Squashfs partitions, chroot directly into core system trees, and build tailored filesystems using EXT4, F2FS, EROFS, or Microsoft FAT/NTFS standards.
            </p>
          </div>

          {/* Navigation Controls */}
          <div className="flex bg-[#0a0d18] border border-[#1e293b] p-1 rounded-xl shrink-0">
            <button
              onClick={() => setActiveTab('fs_matrix')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'fs_matrix'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" /> File System Matrix
            </button>

            <button
              onClick={() => setActiveTab('iso_dissector')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'iso_dissector'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3.5 h-3.5" /> ISO Dissector & cubic
            </button>

            <button
              onClick={() => setActiveTab('chroot_customizer')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'chroot_customizer'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" /> Chroot Customizer
            </button>
          </div>
        </div>
      </div>

      {/* SUB TAB 1: FILE SYSTEM MATRIX (EXT2/3/4, NTFS, exFAT, FAT32, F2FS, EROFS) */}
      {activeTab === 'fs_matrix' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* FS SELECTION LIST & CONFIGURATOR CARD (GUI in Front) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">1</span>
                  Configure Target File System Standard (GUI)
                </h3>
                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-bold uppercase">
                  FS PROFILER
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed mb-5">
                Choose a partition standard. Configure physical sectors block sizing, journaling parameters, over-provisioning bounds, or custom read-only multi-block compression codecs.
              </p>

              {/* Grid selectors */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {fsProfiles.map((fs) => (
                  <button
                    key={fs.id}
                    onClick={() => setSelectedFsId(fs.id)}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between h-[100px] ${
                      selectedFsId === fs.id
                        ? 'bg-indigo-600/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/20'
                        : 'bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-850'
                    }`}
                  >
                    <div>
                      <span className="block font-extrabold text-xs tracking-wide">{fs.id.toUpperCase()}</span>
                      <span className="text-[8.5px] text-slate-500 block mt-0.5 truncate leading-none">{fs.creator}</span>
                    </div>
                    
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded self-start ${
                      fs.isReadOnly 
                        ? 'bg-rose-500/10 text-rose-400' 
                        : 'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {fs.isReadOnly ? 'READ-ONLY' : 'READ-WRITE'}
                    </span>
                  </button>
                ))}
              </div>

              {/* Advanced properties Tweak Controls */}
              <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-900 space-y-4">
                <span className="text-[10px] font-bold uppercase font-mono text-slate-400 tracking-wider block">FS Physical Tweaking parameters</span>

                {/* Block Sizer selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Sector Block / Cluster Allocation Sizing</label>
                    <select
                      value={selectedBlockSize}
                      onChange={(e) => setSelectedBlockSize(Number(e.target.value))}
                      className="w-full bg-[#0a0d18] border border-slate-900 rounded p-2 text-xs text-slate-200 focus:outline-none font-mono"
                    >
                      {currentProfile.blockSizes.map(size => (
                        <option key={size} value={size}>
                          {size >= 1024 ? `${size / 1024} KB` : `${size} Bytes`} {size === 4096 ? '(AOSP Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Contextual Options depending on FS ID */}
                  {selectedFsId === 'erofs' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Huawei EROFS Compression Algorithm</label>
                      <select
                        value={erofsCompressionAlgo}
                        onChange={(e) => setErofsCompressionAlgo(e.target.value as any)}
                        className="w-full bg-[#0a0d18] border border-slate-900 rounded p-2 text-xs text-slate-200 focus:outline-none font-mono"
                      >
                        <option value="lz4">LZ4 Standard (Fast decompress)</option>
                        <option value="lz4hc">LZ4HC High Compression (lz4hc,9)</option>
                        <option value="zstd">ZSTD Dynamic Payload Compressor</option>
                      </select>
                    </div>
                  )}

                  {(selectedFsId === 'ext3' || selectedFsId === 'ext4') && (
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Journaling Write Transaction Mode</label>
                      <select
                        value={extJournalMode}
                        onChange={(e) => setExtJournalMode(e.target.value as any)}
                        className="w-full bg-[#0a0d18] border border-slate-900 rounded p-2 text-xs text-slate-200 focus:outline-none font-mono"
                      >
                        <option value="ordered">Ordered (Metadata prioritized - standard)</option>
                        <option value="journal">Journal (Double-written blocks - maximum safety)</option>
                        <option value="writeback">Writeback (Performance tuned - crash vulnerable)</option>
                      </select>
                    </div>
                  )}

                  {selectedFsId === 'f2fs' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Wear Over-Provisioning Storage reserve</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="20"
                          value={f2fsOverprovision}
                          onChange={(e) => setF2fsOverprovision(Number(e.target.value))}
                          className="flex-1 h-1 bg-[#0a0d18] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <span className="text-xs text-indigo-400 font-mono font-bold w-10 text-right">{f2fsOverprovision}%</span>
                      </div>
                    </div>
                  )}

                  {selectedFsId === 'fat32' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">FAT Reserved Boot Sectors</label>
                      <select
                        value={fatReservedSectors}
                        onChange={(e) => setFatReservedSectors(Number(e.target.value))}
                        className="w-full bg-[#0a0d18] border border-slate-900 rounded p-2 text-xs text-slate-200 focus:outline-none font-mono"
                      >
                        <option value="32">32 sectors (Standard UEFI compatibility)</option>
                        <option value="64">64 sectors (Extended custom grub partitions)</option>
                        <option value="128">128 sectors (Legacy fallback BIOS)</option>
                      </select>
                    </div>
                  )}

                  {selectedFsId === 'ntfs' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Transactional NTFS Compression</label>
                      <button
                        onClick={() => setNtfsEnableCompression(!ntfsEnableCompression)}
                        className={`w-full py-2 px-3 border rounded text-xs font-bold text-left transition-all ${
                          ntfsEnableCompression 
                            ? 'bg-indigo-500/10 border-indigo-500 text-indigo-300' 
                            : 'bg-[#0a0d18] border-slate-900 text-slate-500'
                        }`}
                      >
                        {ntfsEnableCompression ? 'ENABLED (lznt1 algorithm)' : 'DISABLED (no block compression)'}
                      </button>
                    </div>
                  )}
                </div>

                {/* EROFS Level Slider */}
                {selectedFsId === 'erofs' && (
                  <div className="pt-2">
                    <div className="flex justify-between text-xs font-mono mb-1.5 text-slate-300">
                      <span>LZ4HC Compression Grade:</span>
                      <span className="text-indigo-400 font-bold">Level {erofsCompressionLevel} (Slowest pack, fastest mount)</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="12"
                      value={erofsCompressionLevel}
                      onChange={(e) => setErofsCompressionLevel(Number(e.target.value))}
                      className="w-full h-1 bg-[#0a0d18] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Visual feedback metrics estimation */}
            <div className="mt-5 grid grid-cols-5 gap-3 pt-4 border-t border-slate-900">
              {[
                { label: 'Seek Speed', score: selectedFsId === 'erofs' ? '98%' : selectedFsId === 'f2fs' ? '92%' : '75%', col: 'text-indigo-400' },
                { label: 'Wear Guard', score: selectedFsId === 'f2fs' ? '95%' : selectedFsId === 'erofs' ? '100%' : '20%', col: 'text-emerald-400' },
                { label: 'Space Compress', score: selectedFsId === 'erofs' ? '90%' : selectedFsId === 'ntfs' && ntfsEnableCompression ? '55%' : '0%', col: 'text-amber-400' },
                { label: 'Robustness', score: selectedFsId === 'ext4' ? '95%' : selectedFsId === 'ext2' ? '30%' : '85%', col: 'text-rose-400' },
                { label: 'Compatibility', score: selectedFsId === 'fat32' ? '100%' : selectedFsId === 'exfat' ? '90%' : '45%', col: 'text-cyan-400' }
              ].map((m, i) => (
                <div key={i} className="text-center bg-slate-950 p-2 rounded-lg border border-slate-900/40">
                  <span className="block text-[8.5px] text-slate-500 uppercase font-mono font-bold">{m.label}</span>
                  <span className={`block font-mono text-xs font-bold mt-1 ${m.col}`}>{m.score}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT COLUMN: DETAILED INFO & FORMAT COMMAND SHELL (Background Code) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-grow flex flex-col justify-between h-full">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <Code className="w-4 h-4 text-indigo-400" /> File System Specifications (Coding)
                  </h3>
                  <span className="text-[10px] font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    {currentProfile.id.toUpperCase()} Standard
                  </span>
                </div>

                <div className="space-y-4">
                  {/* FS Description info */}
                  <div className="p-3 bg-indigo-950/10 border border-indigo-500/10 rounded-xl">
                    <h4 className="text-xs font-bold text-white mb-1 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-indigo-400" /> Platform Architecture Overview
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      {currentProfile.description}
                    </p>
                  </div>

                  {/* Partition limits box */}
                  <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
                    <div className="p-2 bg-[#090c15] rounded border border-slate-900">
                      <span className="text-slate-500 block">Max File Size:</span>
                      <span className="text-slate-300 font-bold block mt-0.5">
                        {selectedFsId === 'fat32' ? '4 GB (strict)' : selectedFsId === 'ext2' ? '2 TB' : '16 TB - Unlimited'}
                      </span>
                    </div>

                    <div className="p-2 bg-[#090c15] rounded border border-slate-900">
                      <span className="text-slate-500 block">Encryption Support:</span>
                      <span className="text-slate-300 font-bold block mt-0.5">
                        {['ext4', 'f2fs', 'ntfs'].includes(selectedFsId) ? 'Native Crypt-FDE / FBE' : 'Via dm-crypt container'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic UNIX shell formatting command output */}
              <div className="mt-6 pt-5 border-t border-slate-900 space-y-3">
                <div className="flex justify-between items-center text-[10.5px] font-mono">
                  <span className="text-slate-400 font-bold">Generated UNIX shell command:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedMkfsCmd);
                      alert('Copied formatting command!');
                    }}
                    className="p-1 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white rounded border border-slate-800 text-[9.5px] font-mono transition-colors flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </div>

                <div className="bg-[#050811] p-3 rounded-lg border border-slate-900/80 font-mono text-xs text-indigo-300 select-all leading-normal">
                  <span className="text-slate-600"># Formatting super partition layer dynamically</span><br />
                  <span className="text-emerald-400">sudo </span> {generatedMkfsCmd}
                </div>

                <p className="text-[10px] text-slate-500 leading-relaxed">
                  *Executing this command in the automated workspace bundles will format target sectors according to sector align parameters, ensuring structural mounting safety.
                </p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* SUB TAB 2: ISO DISSECTOR (Unpacking squashfs-root & structures) */}
      {activeTab === 'iso_dissector' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* ISO FILE NAVIGATOR & EXTRACTION PANEL (GUI in Front) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">2</span>
                  Dissect Hybrid ISO Payload (GUI in Front)
                </h3>
                <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-900">
                  Cubic-like Tree View
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-normal mb-5">
                Load your customized boot ISO. The file navigator exposes the internal partition layout of isolinux sectors, boot configurations, and compressed file structures.
              </p>

              {/* Load preset ISO block */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-950 rounded-xl border border-slate-900 mb-5">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Target ISO Payload Image</label>
                  <select
                    value={selectedIsoName}
                    onChange={(e) => {
                      setSelectedIsoName(e.target.value);
                      setIsoSize(e.target.value.includes('ubuntu') ? '3.82 GB' : '1.85 GB');
                      setIsDissected(false);
                    }}
                    className="w-full bg-[#0a0d18] border border-slate-900 rounded p-2 text-xs text-slate-200 focus:outline-none font-mono"
                  >
                    <option value="ubuntu-24.04-aosp-hybrid-amd64.iso">ubuntu-24.04-aosp-hybrid-amd64.iso (Linux + AOSP)</option>
                    <option value="android-x86-9.0-pie-r2.iso">android-x86-9.0-pie-r2.iso (AOSP x86 distribution)</option>
                    <option value="gsi-installer-recovery-x86_64.iso">gsi-installer-recovery-x86_64.iso (Custom UEFI Flasher)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleTriggerDissection}
                    disabled={isDissecting}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg text-xs transition-all shadow cursor-pointer flex items-center justify-center gap-2 h-[38px]"
                  >
                    {isDissecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {isDissecting ? `Dissecting (${dissectionProgress}%)...` : "Dissect ISO Structure"}
                  </button>
                </div>
              </div>

              {/* LIVE TREE DISCOVERY WORKSPACE */}
              {isDissected ? (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase font-mono text-slate-400 tracking-wider block">Dissected ISO Filesystem Tree</span>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 h-[280px] overflow-y-auto scrollbar-thin">
                    {renderTree(virtualIsoTree)}
                  </div>
                </div>
              ) : isDissecting ? (
                <div className="h-[280px] bg-slate-950 rounded-xl border border-slate-900 flex flex-col items-center justify-center text-center p-6 animate-pulse">
                  <RefreshCw className="w-12 h-12 text-indigo-400 animate-spin mb-3" />
                  <span className="font-bold text-xs text-white">Uncompressing Squashfs / Read-Only Blocks...</span>
                  <span className="text-[10px] text-slate-500 mt-1">This parses kernel image structures, system filesystems, and isolinux headers.</span>
                </div>
              ) : (
                <div className="h-[280px] bg-slate-950 rounded-xl border border-slate-900 flex flex-col items-center justify-center text-center p-6">
                  <FolderOpen className="w-12 h-12 text-slate-800 mb-2" />
                  <span className="font-bold text-xs text-slate-400">ISO is currently packed.</span>
                  <span className="text-[10px] text-slate-600 mt-1">Click "Dissect ISO Structure" to run extraction.</span>
                </div>
              )}
            </div>

            {/* Micro progress bar for dissection process */}
            {isDissecting && (
              <div className="mt-5 p-3.5 bg-indigo-500/5 border border-indigo-500/10 rounded-xl space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                  <span className="text-indigo-400">Extracting Squashfs blocks...</span>
                  <span className="text-indigo-300">{dissectionProgress}%</span>
                </div>
                <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${dissectionProgress}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: RAW FILE VIEWER / INJECTOR (Background Code) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-grow flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <Terminal className="w-4 h-4 text-indigo-400" /> Dissected File inspector
                  </h3>
                  
                  {selectedFileNode && (
                    <button
                      onClick={() => copyToClipboardText(fileEditorContent)}
                      className="px-2 py-0.5 bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400 hover:text-white rounded"
                    >
                      {editorCopyFeedback ? 'Copied!' : 'Copy Code'}
                    </button>
                  )}
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  Inspect and tweak the files extracted from your ISO (e.g. bootloader configurations like `grub.cfg` or package manifests).
                </p>

                {selectedFileNode ? (
                  <div className="space-y-3">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 bg-slate-950/80 p-2 rounded border border-slate-900">
                      <span>Path: {selectedFileNode.path}</span>
                      <span>Format: {selectedFileNode.contentType}</span>
                    </div>

                    <textarea
                      value={fileEditorContent}
                      onChange={(e) => setFileEditorContent(e.target.value)}
                      className="w-full bg-[#050811] text-indigo-300 font-mono text-[10.5px] leading-relaxed resize-none p-3.5 rounded-xl border border-slate-900 h-[220px] focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="h-[260px] bg-[#050811]/50 rounded-xl border border-slate-900 flex flex-col items-center justify-center text-slate-600 text-center text-xs">
                    <FileCode className="w-12 h-12 text-slate-800 mb-2" />
                    <span>Select a file from the dissected ISO tree to edit its code or parameters.</span>
                  </div>
                )}
              </div>

              {/* Process output log stream of ISO fuser */}
              <div className="pt-4 border-t border-slate-900/80 mt-5 font-mono text-[10px] text-slate-500">
                <span className="uppercase font-bold block mb-1">Cubic Dissector Logs (Background)</span>
                <div className="bg-[#050811] p-3 rounded-lg border border-slate-900 text-slate-400 h-[95px] overflow-y-auto space-y-1">
                  {dissectorLogs.length > 0 ? (
                    dissectorLogs.map((log, i) => (
                      <div key={i} className="truncate"><span className="text-indigo-400">#</span> {log}</div>
                    ))
                  ) : (
                    <div className="text-slate-700 italic h-full flex items-center justify-center">Log stream is idle. Dissect ISO to boot.</div>
                  )}
                </div>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* SUB TAB 3: CHROOT CUSTOMIZER TERMINAL (Virtual sandboxed environment edits) */}
      {activeTab === 'chroot_customizer' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* LEFT PANEL: CHROOT TERMINAL SIMULATION (GUI in Front) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4.5 h-4.5 text-indigo-400" /> Sandboxed System Chroot (GUI in Front)
                </h3>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-bold uppercase">
                  ROOT PRIVILEGES
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-normal mb-5">
                Execute commands as root inside your dissected filesystem environment. Type commands to install custom platform libraries or compile dynamic AOSP utilities.
              </p>

              {/* Terminal View */}
              <div className="bg-[#050811] rounded-xl border border-slate-900 p-4 font-mono text-xs text-slate-300 h-[260px] overflow-y-auto space-y-1.5 flex flex-col justify-between scrollbar-thin">
                <div className="space-y-1.5 flex-1">
                  <div className="text-slate-500 border-b border-slate-900 pb-1.5 text-[10px] flex justify-between">
                    <span>Cubic Sandboxed Container: ubuntu-24.04-aosp-hybrid</span>
                    <span>Session: Interactive Bash shell</span>
                  </div>
                  {chrootTerminalLogs.map((log, index) => (
                    <div key={index} className="whitespace-pre-wrap leading-relaxed text-slate-400">
                      {log}
                    </div>
                  ))}
                </div>

                {/* CMD Form inline */}
                <form onSubmit={handleSendChrootCmd} className="flex items-center border-t border-slate-900 pt-2 mt-3">
                  <span className="text-emerald-400 font-bold mr-2 shrink-0">[root@cubic-host /]#</span>
                  <input
                    type="text"
                    value={chrootInputCmd}
                    onChange={(e) => setChrootInputCmd(e.target.value)}
                    placeholder="e.g. apt install rsync OR click clear"
                    className="flex-grow bg-transparent text-white border-none outline-none focus:ring-0 font-mono text-xs py-0.5"
                    id="chroot-cmd-input"
                  />
                </form>
              </div>

              {/* Predefined prompt helpers */}
              <div className="mt-4 flex flex-wrap gap-2.5">
                {[
                  { label: 'Install mkfs.erofs', cmd: 'apt install erofs-utils' },
                  { label: 'Install F2FS formatter', cmd: 'apt install f2fs-tools' },
                  { label: 'Check system release info', cmd: 'cat /etc/os-release' },
                  { label: 'Clear Console logs', cmd: 'clear' }
                ].map((helper, i) => (
                  <button
                    key={i}
                    onClick={() => setChrootInputCmd(helper.cmd)}
                    className="px-2.5 py-1 bg-slate-950 hover:bg-slate-900 border border-slate-900 hover:border-slate-850 text-[10px] font-mono text-indigo-400 hover:text-indigo-300 rounded transition-all cursor-pointer"
                  >
                    {helper.cmd}
                  </button>
                ))}
              </div>
            </div>

            {/* Package inventory counts */}
            <div className="pt-4 border-t border-slate-900/80 mt-5 flex justify-between items-center text-[10px] font-mono text-slate-500">
              <span>Dynamic Overlay Modules: {installedPackages.length} active packages</span>
              <span>Workspace host status: <strong className="text-emerald-400 font-bold uppercase">SANDBOX_ACTIVE</strong></span>
            </div>
          </div>

          {/* RIGHT COLUMN: PACKAGE OVERLAYS & ISO COMPILATION (Background Code) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-grow flex flex-col justify-between h-full">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <FolderSync className="w-4 h-4 text-indigo-400" /> ISO Compilation & Packing (Background)
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">xorriso pipeline</span>
                </div>

                <p className="text-xs text-slate-400 leading-normal mb-4">
                  Once your chroot configurations, modified scripts, and overlay packages look correct, package it back into a portable bootloader ISO using `xorriso` and `mksquashfs`.
                </p>

                {/* Packaging actions */}
                <div className="space-y-4">
                  <button
                    onClick={handleRepackageIso}
                    disabled={isRepackaging}
                    className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-40 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isRepackaging ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {isRepackaging ? 'Compressing ISO distribution...' : 'Repackage OS Distribution ISO'}
                  </button>

                  {repackagedIsoDetails && (
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="font-bold text-xs text-white">ISO Repackaged Successfully!</span>
                      </div>
                      <div className="grid grid-cols-2 gap-y-1 text-[10px] font-mono text-slate-400">
                        <span>Image:</span><span className="text-slate-300 font-bold truncate text-right">{repackagedIsoDetails.name}</span>
                        <span>Size:</span><span className="text-slate-300 font-bold text-right">{repackagedIsoDetails.size}</span>
                        <span>Hash:</span><span className="text-slate-300 font-bold truncate text-right">{repackagedIsoDetails.hash}</span>
                      </div>
                      <button
                        onClick={() => alert('Downloading custom operating system ISO...')}
                        className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 rounded text-[10px] font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" /> Download Burnable ISO Image
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Code output for xorriso assembly scripts */}
              <div className="mt-5 pt-4 border-t border-slate-900 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block font-mono">Behind-the-scenes packing script</span>
                <textarea
                  readOnly
                  value={compiledXorrisoCode}
                  className="w-full bg-[#050811] text-indigo-300 font-mono text-[10px] leading-relaxed resize-none p-3 rounded-lg border border-slate-900 h-[175px] focus:outline-none"
                />
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
