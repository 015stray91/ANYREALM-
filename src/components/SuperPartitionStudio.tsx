/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Terminal, 
  Wrench, 
  Plus, 
  Trash2, 
  Play, 
  RefreshCw, 
  FileDown, 
  Check, 
  AlertTriangle, 
  HardDrive, 
  ChevronRight, 
  Cpu, 
  FolderTree, 
  Layers, 
  FileCode, 
  Shield, 
  Activity, 
  Copy,
  Hammer,
  Maximize2,
  Minimize2,
  Workflow
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LogicalPartition {
  name: string;
  sizeMb: number;
  filesystem: 'erofs' | 'ext4' | 'f2fs';
  erofsCompression: 'lz4' | 'lz4hc' | 'none';
  readOnly: boolean;
  description: string;
}

interface RomTask {
  id: string;
  name: string;
  category: string;
  description: string;
  dependencies: string[];
  binaries: string[];
  syntax: string;
  commands: string;
  explanation: string;
}

const romTasks: RomTask[] = [
  {
    id: 'unpack_super',
    name: 'Unpack Dynamic Super Partition',
    category: 'Android Boot, Super, & Payload Formats',
    description: 'Unpack a unified modern dynamic super.img volume into separate core logical partition images (system, vendor, product, system_ext).',
    dependencies: ['android-sdk-libsparse-utils', 'p7zip-full'],
    binaries: ['simg2img', 'lpunpack'],
    syntax: 'simg2img [input_sparse_super.img] [output_raw_super.raw] && lpunpack [output_raw_super.raw] [output_dir/]',
    commands: `# Step 1: Convert sparse super.img to raw uncompressed block format
simg2img super.img super.raw

# Step 2: Extract individual partitions from raw super container to output folder
lpunpack super.raw ./extracted_partitions/

# Step 3: Verify the extracted system, vendor, and product partition images
ls -la ./extracted_partitions/`,
    explanation: 'Modern Android dynamic partitions are stored inside a single sparse super.img partition. simg2img converts this sparse block file into raw bytes. Then lpunpack reads the partition metadata headers and extracts each sub-partition.'
  },
  {
    id: 'deconstruct_boot',
    name: 'Deconstruct Android Boot Image',
    category: 'Android Boot, Super, & Payload Formats',
    description: 'Deconstruct Android boot.img or vendor_boot.img headers and payload to isolate kernel binaries and extract integrated LZ4/GZIP/ZSTD ramdisks.',
    dependencies: ['lz4', 'gzip', 'zstd', 'p7zip-full'],
    binaries: ['unpackbootimg', 'mkbootimg'],
    syntax: 'unpackbootimg -i boot.img -o ./extracted_boot/',
    commands: `# Unpack kernel, ramdisk, dtb from the boot image header structure
unpackbootimg -i boot.img -o ./extracted_boot/

# Decompress ramdisk payload using correct compression algorithms (lz4, gzip, or zstd)
cd ./extracted_boot/
if [ -f ramdisk ]; then
  # Auto-detect format and unpack ramdisk rootfs tree
  mv ramdisk ramdisk.lz4
  lz4 -d ramdisk.lz4 ramdisk.cpio
  mkdir -p ./ramdisk_root/ && cd ./ramdisk_root/
  cpio -idm < ../ramdisk.cpio
fi`,
    explanation: 'Boot images contain the Linux kernel and an initial ramdisk (cpio archive compressed via LZ4, GZIP, or ZSTD). unpackbootimg parses Android boot image headers (versions 0-4) and splits them into raw components.'
  },
  {
    id: 'assemble_erofs',
    name: 'Assemble High-Performance EROFS',
    category: 'File System Manipulation & Extraction Utilities',
    description: 'Assemble system folder filesystems into EROFS format images featuring page-cache sharing and LZ4-HC hardware-level compression.',
    dependencies: ['erofs-utils'],
    binaries: ['mkfs.erofs', 'dump.erofs'],
    syntax: 'mkfs.erofs -zlz4hc,9 [output_image.img] [source_directory/]',
    commands: `# Compress directory contents using ultra high density LZ4-HC with level 9 tuning
mkfs.erofs -zlz4hc,9 \\
  --fsconfig-conf=./system/core/libcutils/fs_config.conf \\
  -T 1718000000 \\
  ./out/target/product/generic/system.img \\
  ./system_rootfs/

# Audit built erofs structure to output block diagnostics
dump.erofs ./out/target/product/generic/system.img`,
    explanation: 'EROFS is Android’s modern read-only file system. It provides near-zero compression latency, high-speed random read access, and substantial system storage space savings.'
  },
  {
    id: 'unpack_payload',
    name: 'Decompress OTA Firmware Payload',
    category: 'Android Boot, Super, & Payload Formats',
    description: 'Parse and dump OTA firmware updates straight from payload.bin containers.',
    dependencies: ['payload-dumper-go', 'p7zip-full'],
    binaries: ['payload-dumper-go', '7z'],
    syntax: '7z x [ota_update.zip] payload.bin && payload-dumper-go -o ./extracted_partitions/ payload.bin',
    commands: `# Extract payload.bin from the OTA zip package
7z x ota_update_package.zip payload.bin

# Perform high-speed parallel decompression of all partition images inside the OTA payload
payload-dumper-go -o ./extracted_partitions/ payload.bin

# List decompressed sector block images
ls -lh ./extracted_partitions/`,
    explanation: 'Android system updates (OTAs) store block changes inside payload.bin files. payload-dumper-go parses the protobuf metadata instructions and decodes block-by-block images.'
  },
  {
    id: 'compile_dtb',
    name: 'Compile / Decompile Device Tree (DTC)',
    category: 'Device Tree (Hardware Blueprint) Tooling',
    description: 'Extract and disassemble binary device trees (.dtb/.dtbo) to editable structured tree (.dts) text, then recompile back to flashable blobs.',
    dependencies: ['device-tree-compiler'],
    binaries: ['dtc'],
    syntax: 'dtc -I dtb -O dts -o [output.dts] [input.dtb]',
    commands: `# Step 1: Decompile binary Device Tree Blob into human-editable source format
dtc -I dtb -O dts -o custom_device_tree.dts device_tree.dtb

# Step 2: Edit device nodes and parameters (e.g. clock speeds, GPIO values, power rails)
sed -i 's/status = "disabled"/status = "okay"/g' custom_device_tree.dts

# Step 3: Recompile edited dts layout back to device-tree-compiler binary
dtc -I dts -O dtb -o custom_device_tree_modified.dtb custom_device_tree.dts`,
    explanation: 'The Device Tree (DT) is a hardware description blueprint used by Android kernels to discover and configure connected physical peripherals (chips, displays, sensors).'
  },
  {
    id: 'squashfs_dissect',
    name: 'Dissect Squashed Filesystem Layout',
    category: 'File System Manipulation & Extraction Utilities',
    description: 'Extract and repack squashed directories (mksquashfs/unsquashfs) with aggressive block compression limits.',
    dependencies: ['squashfs-tools', 'tar'],
    binaries: ['unsquashfs', 'mksquashfs'],
    syntax: 'unsquashfs -d ./extracted_squashfs/ system.squashfs',
    commands: `# Decompress existing system.squashfs filesystem to edit core permissions
unsquashfs -d ./extracted_squashfs/ system.squashfs

# Repack edited filesystem back using optimal XZ block size compression parameters
mksquashfs ./extracted_squashfs/ system_new.squashfs \\
  -comp xz \\
  -b 1048576 \\
  -noappend \\
  -all-root`,
    explanation: 'Squashfs is a compressed read-only file system for Linux. It is widely used in recovery environments, live distros, and secondary system components to maximize storage efficiency.'
  },
  {
    id: 'binwalk_heuristics',
    name: 'Deep Signature Extraction (Binwalk)',
    category: 'File System Manipulation & Extraction Utilities',
    description: 'Perform deep heuristic analysis and signature carving across unformatted raw storage and firmware blobs.',
    dependencies: ['binwalk', 'squashfs-tools', 'p7zip-full'],
    binaries: ['binwalk'],
    syntax: 'binwalk -e -M firmware.bin',
    commands: `# Scan raw firmware dump file for headers, file system layouts, and magic signatures
binwalk firmware.bin

# Perform recursive extraction and carving of all discovered embedded image blocks
binwalk -e -M firmware.bin

# Explore extracted signature payloads
ls -la ./_firmware.bin.extracted/`,
    explanation: 'Binwalk scans raw binary streams for known magic bytes and signatures. It automatically unzips, untars, or unsquashes any identified filesystems recursively.'
  },
  {
    id: 'e2fsprogs_matrix',
    name: 'Repair & Resize EXT4 Block Matrix',
    category: 'File System Manipulation & Extraction Utilities',
    description: 'Perform partition volume repairs, block verification, and size transformations for EXT4 block images.',
    dependencies: ['e2fsprogs'],
    binaries: ['e2fsck', 'resize2fs', 'tune2fs'],
    syntax: 'e2fsck -f [image.img] && resize2fs [image.img] [size_mb]M',
    commands: `# Step 1: Perform full structural integrity pass check on the ext4 partition
e2fsck -fy ./system.img

# Step 2: Strip specific checksum metadata flags to ensure bootloader compatibility
tune2fs -O ^metadata_csum ./system.img

# Step 3: Resize partition filesystem blocks to a tight, custom allocation (e.g. 2048MB)
resize2fs ./system.img 2048M`,
    explanation: 'EXT4 remains an essential read-write filesystem inside Android partitions. e2fsprogs enables partition table sizing compliance, checking, and parameter optimizations.'
  },
  {
    id: 'fastboot_flash',
    name: 'Flash Images with Fastboot Interface',
    category: 'Flashing & Direct Communication Utilities',
    description: 'Deploy compiled Android system partition structures straight to connected target boards via ADB / Fastboot protocol.',
    dependencies: ['android-tools-adb', 'android-tools-fastboot'],
    binaries: ['adb', 'fastboot'],
    syntax: 'adb reboot bootloader && fastboot flash super super.img',
    commands: `# Step 1: Ensure host communication and reboot target board to fastboot mode
adb devices
adb reboot bootloader

# Step 2: Verify device handshakes over USB fastboot protocol
fastboot devices

# Step 3: Flash raw or sparse super.img to device's physical storage
fastboot flash super ./out/target/product/generic/super.img

# Step 4: Reboot board into compiled system
fastboot reboot`,
    explanation: 'Fastboot is a diagnostic and provisioning protocol used to flash custom firmware directly to physical system partitions while the CPU is in a pre-boot bootloader state.'
  },
  {
    id: 'build_toolchains',
    name: 'Build System Toolchains & Core Libraries',
    category: 'Essential System Toolchains & Core Libraries',
    description: 'Establish gcc/g++ compilers, mathematical processors, cryptographic tools, and command-line XML/JSON parsers for the workspace compiling environment.',
    dependencies: ['build-essential', 'bc', 'bison', 'flex', 'libssl-dev', 'libcrypto++-dev', 'git', 'jq', 'rsync', 'fd-find'],
    binaries: ['gcc', 'make', 'bc', 'bison', 'flex', 'jq', 'rsync', 'fd'],
    syntax: 'apt-get install -y build-essential bc bison flex libssl-dev libcrypto++-dev git jq rsync fd-find',
    commands: `# Sync custom Android hardware description tree
git clone https://github.com/aosp-builder/device_manifest.git

# Parse system variables, device specs, and hardware components configuration using jq
jq '.device[] | select(.battery_mah > 4000)' ./device_manifest/specs.json

# Perform rapid synchronizations of files preserving physical permissions
rsync -avPR --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r ./source_dir/ ./target_rootfs/`,
    explanation: 'Preparing full compilation toolchains and standard libraries guarantees build-agent capability. JQ parses JSON files, BC solves complex floating-point constraints, and RSYNC duplicates partition filesystem layouts preserving raw metadata.'
  }
];

export default function SuperPartitionStudio() {
  // Super Partition Meta Configuration
  const [superCapacityMb, setSuperCapacityMb] = useState<number>(4096); // 4GB Default
  const [metadataSizeKb, setMetadataSizeKb] = useState<number>(64);
  const [metadataSlots, setMetadataSlots] = useState<number>(2);
  const [alignmentBytes, setAlignmentBytes] = useState<number>(4096);
  const [targetBlockDevice, setTargetBlockDevice] = useState<string>('super');

  // Interactive Partition List (AOSP standard partitions)
  const [partitions, setPartitions] = useState<LogicalPartition[]>([
    {
      name: 'system',
      sizeMb: 1500,
      filesystem: 'erofs',
      erofsCompression: 'lz4hc',
      readOnly: true,
      description: 'Android Core Operating System OS binaries, frameworks, and JNI linkages fused with Linux glibc dependencies.'
    },
    {
      name: 'vendor',
      sizeMb: 600,
      filesystem: 'erofs',
      erofsCompression: 'lz4',
      readOnly: true,
      description: 'Device-specific HAL services, AIDL drivers, hardware modules, and proprietary blobs.'
    },
    {
      name: 'product',
      sizeMb: 500,
      filesystem: 'erofs',
      erofsCompression: 'none',
      readOnly: true,
      description: 'OEM system specifications, application layers, branding materials, and vendor overlay configs.'
    },
    {
      name: 'system_ext',
      sizeMb: 300,
      filesystem: 'ext4',
      erofsCompression: 'none',
      readOnly: false,
      description: 'Optional system extension packages and custom development toolchains.'
    }
  ]);

  // Form states for creating/editing partition
  const [newPartName, setNewPartName] = useState<string>('rootfs_fused');
  const [newPartSize, setNewPartSize] = useState<number>(800);
  const [newPartFs, setNewPartFs] = useState<'erofs' | 'ext4' | 'f2fs'>('erofs');
  const [newPartCompress, setNewPartCompress] = useState<'lz4' | 'lz4hc' | 'none'>('lz4hc');
  const [newPartReadOnly, setNewPartReadOnly] = useState<boolean>(true);
  const [newPartDesc, setNewPartDesc] = useState<string>('Custom fused Linux standard root filesystem mounted inside the AOSP dynamic partition system.');

  // Simulation parameters
  const [selectedUtensil, setSelectedUtensil] = useState<string>('unpack_super');
  const [selectedMode, setSelectedMode] = useState<'rom_tasks' | 'utensils'>('rom_tasks');
  const [installedPackages, setInstalledPackages] = useState<string[]>([
    'git', 'tar', 'unzip', 'gzip'
  ]);
  const [isInstallingPackages, setIsInstallingPackages] = useState<boolean>(false);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [compileProgress, setCompileProgress] = useState<number>(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Layout View states
  const [isSplitLayout, setIsSplitLayout] = useState<boolean>(true); // Split panel toggle

  // Utility commands builder for current state
  const [lpmakeCommand, setLpmakeCommand] = useState<string>('');
  const [erofsCommands, setErofsCommands] = useState<string[]>([]);

  // Calculate sizes and statistics
  const totalAllocatedMb = partitions.reduce((acc, curr) => acc + curr.sizeMb, 0);
  const freeSpaceMb = Math.max(0, superCapacityMb - totalAllocatedMb);
  const allocationPercentage = Math.min(100, (totalAllocatedMb / superCapacityMb) * 100);
  const isOverAllocated = totalAllocatedMb > superCapacityMb;

  // Recalculate dynamic commands when settings change
  useEffect(() => {
    // Generate lpmake command
    const superBytes = superCapacityMb * 1024 * 1024;
    
    let command = `lpmake \\\n`;
    command += `  --metadata-size ${metadataSizeKb * 1024} \\\n`;
    command += `  --metadata-slots ${metadataSlots} \\\n`;
    command += `  --device ${targetBlockDevice}:${superBytes} \\\n`;
    command += `  --group android_dynamic_group:${superBytes} \\\n`;
    
    // Partitions arguments
    partitions.forEach((p) => {
      const partBytes = p.sizeMb * 1024 * 1024;
      command += `  --partition ${p.name}:readonly:${partBytes}:android_dynamic_group \\\n`;
    });

    // Staged partition image file listings
    partitions.forEach((p) => {
      command += `  --image ${p.name}=./out/target/product/generic/${p.name}.img \\\n`;
    });

    command += `  --output ./out/target/product/generic/super.img`;
    setLpmakeCommand(command);

    // Generate mkfs.erofs commands
    const erofsCmds = partitions
      .filter((p) => p.filesystem === 'erofs')
      .map((p) => {
        let opt = '';
        if (p.erofsCompression === 'lz4hc') {
          opt = ' -zlz4hc,9';
        } else if (p.erofsCompression === 'lz4') {
          opt = ' -zlz4';
        } else {
          opt = ' -znone';
        }
        return `mkfs.erofs${opt} --fsconfig-conf=./system/core/libcutils/fs_config.conf -T 1718000000 ./out/target/product/generic/${p.name}.img ./src_folders/${p.name}/`;
      });
    setErofsCommands(erofsCmds);

  }, [partitions, superCapacityMb, metadataSizeKb, metadataSlots, alignmentBytes, targetBlockDevice]);

  // Synchronize selection when mode changes
  useEffect(() => {
    if (selectedMode === 'rom_tasks') {
      setSelectedUtensil('unpack_super');
    } else {
      setSelectedUtensil('lpmake');
    }
  }, [selectedMode]);

  // Sync log on selection or command changes
  useEffect(() => {
    if (!selectedUtensil) return;

    let depLog = '';
    let cmds: string[] = [];

    if (selectedMode === 'rom_tasks') {
      const task = romTasks.find(t => t.id === selectedUtensil);
      if (task) {
        depLog = `[DEPENDENCY INFO]: Requiring packages '${task.dependencies.join("', '")}'${task.binaries.length > 0 ? ` and local binaries '${task.binaries.join("', '")}'` : ''}.`;
        cmds = task.commands.split('\n');
      }
    } else {
      const utensil = utensils.find(u => u.id === selectedUtensil);
      if (utensil) {
        let deps = ['android-sdk-libsparse-utils'];
        let bins: string[] = [];
        if (['lpmake', 'lpunpack', 'lpadd', 'lpremove', 'lpreserved'].includes(utensil.id)) {
          deps = ['android-sdk-libsparse-utils'];
          bins = [utensil.id];
        } else if (['mkfs.erofs', 'erofsunzip', 'fsck.erofs'].includes(utensil.id)) {
          deps = ['erofs-utils'];
          bins = [utensil.id];
        }
        depLog = `[DEPENDENCY INFO]: Requiring packages '${deps.join("', '")}'${bins.length > 0 ? ` and local binaries '${bins.join("', '")}'` : ''}.`;
        
        const commandText = utensil.id === 'lpmake' 
          ? lpmakeCommand 
          : utensil.id === 'mkfs.erofs' 
            ? erofsCommands.join('\n') 
            : utensil.example;
        cmds = commandText.split('\n');
      }
    }

    if (depLog) {
      setTerminalLogs([
        depLog,
        ...cmds.map(cmd => cmd.startsWith('$') || cmd.startsWith('#') || !cmd.trim() ? cmd : `$ ${cmd}`)
      ]);
    }
  }, [selectedUtensil, selectedMode, lpmakeCommand, erofsCommands]);

  const handleInstallPackages = (packages: string[]) => {
    if (isInstallingPackages) return;
    setIsInstallingPackages(true);
    
    // Add logs step-by-step
    const logs = [
      `[apt] Reading package lists... Done`,
      `[apt] Building dependency tree... Done`,
      `[apt] Reading state information... Done`,
      ...packages.map(p => `[apt] Installing: ${p} ...`),
      `[apt] Updating database references... Done`,
      `[SUCCESS] All target ROM building dependencies installed successfully! 🎉`
    ];

    logs.forEach((log, index) => {
      setTimeout(() => {
        setTerminalLogs(prev => [...prev, log]);
        if (index === logs.length - 1) {
          setIsInstallingPackages(false);
          setInstalledPackages(prev => {
            const updated = [...prev];
            packages.forEach(p => {
              if (!updated.includes(p)) updated.push(p);
            });
            return updated;
          });
        }
      }, (index + 1) * 350);
    });
  };

  // Handle adding a new partition
  const handleAddPartition = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartName.trim()) return;

    // Check for duplicates
    if (partitions.some(p => p.name.toLowerCase() === newPartName.toLowerCase())) {
      alert('A partition with this name already exists.');
      return;
    }

    const newPart: LogicalPartition = {
      name: newPartName.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''),
      sizeMb: newPartSize,
      filesystem: newPartFs,
      erofsCompression: newPartFs === 'erofs' ? newPartCompress : 'none',
      readOnly: newPartReadOnly,
      description: newPartDesc || 'Custom partition block inside Android super storage.'
    };

    setPartitions(prev => [...prev, newPart]);
    
    // Trigger quick visual terminal log for partition addition (LP Add)
    logTerminal(`[LP] lpadd - Added partition container table entry: ${newPart.name} (${newPart.sizeMb}MB)`);

    // Reset Form
    setNewPartName('');
    setNewPartDesc('');
  };

  // Handle deleting a partition (LP Remove)
  const handleDeletePartition = (name: string) => {
    setPartitions(prev => prev.filter(p => p.name !== name));
    logTerminal(`[LP] lpremove - Staged removal of partition: ${name}`);
  };

  const logTerminal = (msg: string) => {
    setTerminalLogs(prev => [...prev, msg]);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback("Copied!");
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  // Run dynamic compilation pipeline simulation
  const handleRunSimulation = () => {
    if (isCompiling) return;
    setIsCompiling(true);
    setCompileProgress(2);
    setTerminalLogs([]);

    const steps = [
      { p: 10, l: `[!] Initializing Android partition assembler module (Utensil Suite)...` },
      { p: 20, l: `[!] Validating metadata alignment blocks (Setting padding to ${alignmentBytes} bytes)...` },
      { p: 35, l: `[*] Packing read-only filesystems using Modern EROFS (mkfs.erofs)...` },
      ...partitions.map((p, i) => {
        if (p.filesystem === 'erofs') {
          return {
            p: 35 + Math.round(((i + 1) / partitions.length) * 25),
            l: `[mkfs.erofs] Compressing ./src_folders/${p.name}/ with LZ4-HC... Successfully assembled ${p.name}.img (${Math.round(p.sizeMb * 0.72)}MB EROFS container)`
          };
        } else {
          return {
            p: 35 + Math.round(((i + 1) / partitions.length) * 25),
            l: `[make_ext4] Writing sparse system ext4 inode mapping for ./src_folders/${p.name}/... Generated ${p.name}.img`
          };
        }
      }),
      { p: 65, l: `[SUCCESS] All logical partition containers generated. Total filesystem size: ${Math.round(totalAllocatedMb * 0.85)}MB.` },
      { p: 75, l: `[lpmake] Linking dynamic partition dynamic metadata tables...` },
      { p: 85, l: `[lpmake] Building unified super.img (Block alignment checksums configured correctly)...` },
      { p: 95, l: `[lpmake] Slot A/B metadata entries injected. u:object_r:super_block_device:s0 security parameters enforced.` },
      { p: 100, l: `[SUCCESS] Fused super.img compiled successfully! Ready for fastboot flash super.` }
    ];

    steps.forEach((step, idx) => {
      setTimeout(() => {
        setCompileProgress(step.p);
        logTerminal(step.l);
        if (step.p === 100) {
          setIsCompiling(false);
        }
      }, (idx + 1) * 450);
    });
  };

  // Helper lists for other LP & EROFS commands (The Utensils)
  const utensils = [
    {
      id: 'lpmake',
      name: 'lpmake',
      description: 'Compiles dynamic logical partition tables and writes a flashable AOSP super.img file.',
      syntax: 'lpmake --metadata-size [size] --metadata-slots [slots] --device super:[capacity] --partition [name]:[size] --output super.img',
      example: lpmakeCommand
    },
    {
      id: 'lpunpack',
      name: 'lpunpack / lpunmake',
      description: 'Extracts the system.img, vendor.img, product.img etc. files from a unified super.img volume.',
      syntax: 'lpunpack [options] super.img [output_dir/]',
      example: `lpunpack --slot=0 ./out/target/product/generic/super.img ./extracted_images/\nls -l ./extracted_images/\n# Displays: system.img, vendor.img, product.img`
    },
    {
      id: 'lpadd',
      name: 'lpadd',
      description: 'Adds a dynamic partition slot allocation inside an existing super storage metadata header.',
      syntax: 'lpadd [options] super.img partition_name group_name size_bytes',
      example: `lpadd --slot=0 ./super.img rootfs_fused android_dynamic_group 838860800`
    },
    {
      id: 'lpremove',
      name: 'lpremove',
      description: 'Removes a logical partition metadata slot entry from the Dynamic Partition table.',
      syntax: 'lpremove [options] super.img partition_name',
      example: `lpremove --slot=0 ./super.img system_ext`
    },
    {
      id: 'lpreserved',
      name: 'lpreserved',
      description: 'Manages dynamic storage reserves, sizing constraints, and dynamic group limits inside super.',
      syntax: 'lpreserved [options] super.img group_name reserved_bytes',
      example: `lpreserved --slot=0 ./super.img android_dynamic_group 104857600`
    },
    {
      id: 'mkfs.erofs',
      name: 'mkfs.erofs',
      description: 'Assembles an Enhanced Read-Only File System (EROFS) image with high efficiency lz4 compression.',
      syntax: 'mkfs.erofs -z[compression] [output_file.img] [source_directory/]',
      example: erofsCommands.length > 0 ? erofsCommands.join('\n') : `mkfs.erofs -zlz4hc,9 system.img ./fused_rootfs/`
    },
    {
      id: 'erofsunzip',
      name: 'erofsunzip',
      description: 'Unpacks, lists, or extracts directory layouts and files contained inside an EROFS partition image.',
      syntax: 'erofsunzip [options] image_file.img [destination_dir/]',
      example: `erofsunzip ./out/target/product/generic/system.img ./extracted_system_files/`
    },
    {
      id: 'fsck.erofs',
      name: 'fsck.erofs',
      description: 'Checks EROFS read-only filesystem integrity, showing block counts, UUID, and directory structures.',
      syntax: 'fsck.erofs --extract [image_file.img]',
      example: `fsck.erofs --superblock ./out/target/product/generic/system.img\n# Displays Block size, Inode count, LZ4 configuration, UUID metadata`
    }
  ];

  const currentUtensil = utensils.find(u => u.id === selectedUtensil) || utensils[0];

  return (
    <div className="flex flex-col gap-8" id="super-partition-studio-workspace">
      
      {/* HEADER CARD */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Database className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Workflow className="w-3.5 h-3.5" /> AOSP Partition & Filesystem Compiler
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <Database className="text-indigo-500 w-7 h-7" /> Super Partition Layout & EROFS Visual Studio
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Design, size, and pack Android Dynamic Partition tables in EROFS/ext4 filesystems. Compile images using the complete suite of <code className="text-indigo-300">lp</code> and <code className="text-indigo-300">erofs</code> assembly tools.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSplitLayout(!isSplitLayout)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-950 border border-slate-900 text-slate-400 hover:text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              {isSplitLayout ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              {isSplitLayout ? "Full Coding View" : "Split Layout view"}
            </button>
            <button
              onClick={handleRunSimulation}
              disabled={isCompiling || isOverAllocated}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-40 text-white px-5 py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-500/15 cursor-pointer"
              id="run-lp-synthesis"
            >
              {isCompiling ? <RefreshCw className="w-4.5 h-4.5 animate-spin" /> : <Play className="w-4.5 h-4.5 fill-white" />}
              {isCompiling ? "Compiling Images..." : "Assemble Super Partition"}
            </button>
          </div>
        </div>
      </div>

      {/* OVERVIEW ALLOCATION BAR (GUI in Front) */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-indigo-400" /> Super Block Dynamic Allocator Map (GUI in Front)
            </h3>
            <span className="text-[11px] text-slate-400 block mt-0.5">Visually monitors partition sectors size allocations to avoid image bounds overruns.</span>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-500">Allocated:</span>{' '}
              <span className={`font-bold ${isOverAllocated ? 'text-rose-400' : 'text-indigo-400'}`}>
                {totalAllocatedMb} MB
              </span>
            </div>
            <div>
              <span className="text-slate-500">Total Capacity:</span>{' '}
              <span className="font-bold text-white">{superCapacityMb} MB</span>
            </div>
            <div>
              <span className="text-slate-500">Free:</span>{' '}
              <span className="font-bold text-emerald-400">{freeSpaceMb} MB</span>
            </div>
          </div>
        </div>

        {/* Dynamic block horizontal bar */}
        <div className="w-full h-10 bg-slate-950 rounded-xl overflow-hidden border border-slate-900/80 flex p-1.5 gap-1 shadow-inner relative">
          {partitions.map((p, idx) => {
            const widthPct = (p.sizeMb / superCapacityMb) * 100;
            // Cycle background color based on name/index
            const bgColors = [
              'bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-500/40 text-indigo-300',
              'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-300',
              'bg-blue-500/20 hover:bg-blue-500/30 border-blue-500/40 text-blue-300',
              'bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-300',
              'bg-teal-500/20 hover:bg-teal-500/30 border-teal-500/40 text-teal-300'
            ];
            const styleClass = bgColors[idx % bgColors.length];

            return (
              <div
                key={p.name}
                className={`h-full border rounded-lg flex items-center justify-center font-mono text-[10px] font-bold transition-all relative group cursor-pointer ${styleClass}`}
                style={{ width: `${widthPct}%` }}
              >
                <span className="truncate px-1 text-center">{p.name} ({p.sizeMb}M)</span>
                
                {/* Visual tooltip */}
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-[#0a0d18] border border-slate-800 p-3 rounded-lg text-left hidden group-hover:block z-30 shadow-2xl min-w-[200px] w-max text-[11px] leading-relaxed">
                  <span className="block font-bold text-white uppercase mb-0.5">{p.name} Partition</span>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-400 font-mono text-[10px] mt-1.5 border-t border-slate-900 pt-1.5">
                    <span>File System:</span><span className="text-white font-bold uppercase">{p.filesystem}</span>
                    <span>Compression:</span><span className="text-indigo-400 uppercase">{p.erofsCompression}</span>
                    <span>Capacity:</span><span className="text-white font-semibold">{p.sizeMb} MB</span>
                    <span>Sectors Mode:</span><span className="text-amber-400">{p.readOnly ? 'Read-Only' : 'Read-Write'}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal mt-2 border-t border-slate-900 pt-1.5 max-w-[250px]">{p.description}</p>
                </div>
              </div>
            );
          })}

          {freeSpaceMb > 0 && (
            <div 
              className="h-full border border-dashed border-slate-800 rounded-lg flex items-center justify-center font-mono text-[10px] text-slate-500 bg-slate-900/10"
              style={{ width: `${(freeSpaceMb / superCapacityMb) * 100}%` }}
            >
              <span>{freeSpaceMb}M unallocated</span>
            </div>
          )}
        </div>

        {/* Warnings & error banner */}
        {isOverAllocated && (
          <div className="mt-4 p-3 bg-rose-500/10 rounded-xl border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-400 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span><strong>Critical Layout Space Overrun:</strong> Your partition maps allocate a total of {totalAllocatedMb}MB, exceeding the dynamic super image limit of {superCapacityMb}MB by {totalAllocatedMb - superCapacityMb}MB! Decrease specific partition volumes to proceed.</span>
          </div>
        )}
      </div>

      {/* WORKSPACE DIVIDER: Split visual GUI vs Coding background */}
      <div className={`grid grid-cols-1 ${isSplitLayout ? 'lg:grid-cols-12' : 'grid-cols-1'} gap-8 items-start`}>
        
        {/* LEFT COLUMN: The GUI & Partition Editors (Spans 7 in Split, Full in Single) */}
        <div className={`${isSplitLayout ? 'lg:col-span-7' : 'w-full'} flex flex-col gap-6`}>
          
          {/* UTENSIL PICKER SECTION */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">1</span>
                ROM Customization & AOSP Build Engine
              </h3>
              
              {/* Layout Mode Toggles */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-900">
                <button
                  type="button"
                  onClick={() => setSelectedMode('rom_tasks')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-all cursor-pointer ${
                    selectedMode === 'rom_tasks'
                      ? 'bg-indigo-600 text-white shadow font-bold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  ROM Tasks (12-17)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMode('utensils')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-all cursor-pointer ${
                    selectedMode === 'utensils'
                      ? 'bg-indigo-600 text-white shadow font-bold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  AOSP Utensils
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-normal">
              {selectedMode === 'rom_tasks'
                ? "Select a high-level ROM build or customization task. View the necessary Linux/Debian host packages and command sequences dynamically generated in the Live Document."
                : "Select an image packaging utensil. Modify parameters in the front-end GUI, and watch the underlying background shell script update in real-time."
              }
            </p>

            {selectedMode === 'rom_tasks' ? (
              <>
                {/* ROM Tasks Select Button List */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  {romTasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setSelectedUtensil(task.id)}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                        selectedUtensil === task.id
                          ? 'bg-indigo-600/10 border-indigo-500 text-white shadow'
                          : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      <span className="font-bold text-xs font-mono">{task.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono tracking-tight">{task.category}</span>
                    </button>
                  ))}
                </div>

                {/* Selected Task Details with Dependency Badge */}
                {(() => {
                  const currentRomTask = romTasks.find(t => t.id === selectedUtensil) || romTasks[0];
                  const missingPkgs = currentRomTask.dependencies.filter(pkg => !installedPackages.includes(pkg));
                  return (
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex items-start gap-3">
                        <Wrench className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-xs text-white block uppercase font-mono">{currentRomTask.name} Task</span>
                          <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">{currentRomTask.description}</span>
                          
                          <div className="mt-2 text-[10.5px] text-slate-400">
                            <span className="text-slate-500 uppercase font-bold text-[9px] block mb-1">Concept Explanation:</span>
                            <p className="leading-normal">{currentRomTask.explanation}</p>
                          </div>

                          <div className="mt-2.5 p-2 bg-[#090b14] border border-indigo-500/10 rounded font-mono text-[10px] text-indigo-300">
                            <span className="text-slate-500 uppercase font-bold text-[9px] block mb-1">Standard Command Structure:</span>
                            <code>{currentRomTask.syntax}</code>
                          </div>
                        </div>
                      </div>

                      {/* Packages Info and Interactive APT Tool */}
                      <div className="p-4 bg-slate-950 rounded-xl border border-slate-900">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 border-b border-slate-900 pb-2.5">
                          <span className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider">Host Debian/Ubuntu Dependencies</span>
                          {missingPkgs.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => handleInstallPackages(currentRomTask.dependencies)}
                              disabled={isInstallingPackages}
                              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-[10.5px] font-bold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <RefreshCw className={`w-3 h-3 ${isInstallingPackages ? 'animate-spin' : ''}`} />
                              {isInstallingPackages ? 'Installing...' : `Auto-Install (${missingPkgs.length}) Packages`}
                            </button>
                          ) : (
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <Check className="w-3 h-3" /> All Dependencies Active
                            </span>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          {currentRomTask.dependencies.map(pkg => {
                            const isInstalled = installedPackages.includes(pkg);
                            return (
                              <span
                                key={pkg}
                                className={`px-2.5 py-1 text-[10.5px] font-mono rounded-lg border flex items-center gap-1.5 ${
                                  isInstalled
                                    ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                                    : 'bg-amber-500/5 border-amber-500/20 text-amber-300'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${isInstalled ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                {pkg}
                              </span>
                            );
                          })}
                        </div>
                        
                        {currentRomTask.binaries.length > 0 && (
                          <div className="mt-3.5 pt-3 border-t border-slate-900">
                            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1.5 font-mono">Exposed Command-Line Binaries</span>
                            <div className="flex flex-wrap gap-1.5">
                              {currentRomTask.binaries.map(bin => (
                                <span key={bin} className="px-2 py-0.5 bg-[#0a0d18] text-indigo-400 border border-indigo-500/10 text-[10px] font-mono rounded">
                                  $ {bin}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                {/* Standard AOSP Utensils Selector */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {utensils.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUtensil(u.id)}
                      className={`p-2.5 rounded-lg border text-xs font-mono text-center cursor-pointer transition-all ${
                        selectedUtensil === u.id
                          ? 'bg-indigo-600/10 border-indigo-500 text-white font-bold shadow'
                          : 'bg-slate-950 border-slate-900 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {u.name}
                    </button>
                  ))}
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex items-start gap-3">
                  <Wrench className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-xs text-white block uppercase font-mono">{currentUtensil.name} Utensil</span>
                    <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">{currentUtensil.description}</span>
                    <div className="mt-2.5 p-2 bg-[#090b14] border border-indigo-500/10 rounded font-mono text-[10px] text-indigo-300">
                      <span className="text-slate-500 uppercase font-bold text-[9px] block mb-1">Standard command structure:</span>
                      <code>{currentUtensil.syntax}</code>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* DYNAMIC PARTITIONS LIST (GUI in Front) */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center justify-between border-b border-slate-900 pb-3">
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">2</span>
                Super Volume Dynamic Partitions Table
              </span>
              <span className="text-[10px] font-mono text-slate-500">Active containers: {partitions.length}</span>
            </h3>

            {/* Partitions listing */}
            <div className="space-y-3.5">
              {partitions.map((p) => (
                <div 
                  key={p.name} 
                  className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 max-w-[420px]">
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/5 border border-indigo-500/15 flex items-center justify-center text-indigo-400 font-bold font-mono text-xs shadow-inner uppercase">
                      {p.name.substring(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white">{p.name}</span>
                        <span className="px-1.5 py-0.2 bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 text-[9px] font-bold font-mono rounded uppercase">
                          {p.filesystem}
                        </span>
                        {p.filesystem === 'erofs' && (
                          <span className="px-1.5 py-0.2 bg-teal-500/10 text-teal-400 border border-teal-500/10 text-[9px] font-bold font-mono rounded uppercase">
                            {p.erofsCompression}
                          </span>
                        )}
                        <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded uppercase ${
                          p.readOnly 
                            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/10' 
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/10'
                        }`}>
                          {p.readOnly ? 'Read-Only' : 'Read-Write'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{p.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-5">
                    <div className="text-right font-mono">
                      <span className="text-[10px] text-slate-500 block">Sectors allocation</span>
                      <span className="text-xs font-bold text-white">{p.sizeMb} MB</span>
                    </div>

                    <button
                      onClick={() => handleDeletePartition(p.name)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/5 transition-colors cursor-pointer"
                      title="Remove dynamic partition slot"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Partition Adder Form */}
            <div className="mt-6 pt-5 border-t border-slate-900">
              <span className="text-xs font-bold text-white uppercase block mb-3 font-mono">Bootstrap New Partition Entry (LP Add)</span>
              
              <form onSubmit={handleAddPartition} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Partition Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. system_b, rootfs_fused"
                    value={newPartName}
                    onChange={(e) => setNewPartName(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Partition Size (MB)</label>
                  <input
                    type="number"
                    required
                    min={10}
                    value={newPartSize}
                    onChange={(e) => setNewPartSize(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950/80 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Target Filesystem</label>
                  <select
                    value={newPartFs}
                    onChange={(e) => setNewPartFs(e.target.value as any)}
                    className="w-full bg-slate-950/80 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium font-mono"
                  >
                    <option value="erofs">EROFS (Enhanced Read-Only)</option>
                    <option value="ext4">ext4 (Linux Extended-4)</option>
                    <option value="f2fs">F2FS (Flash Friendly filesystem)</option>
                  </select>
                </div>

                {newPartFs === 'erofs' ? (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Compression Algorithm</label>
                    <select
                      value={newPartCompress}
                      onChange={(e) => setNewPartCompress(e.target.value as any)}
                      className="w-full bg-slate-950/80 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value="lz4hc">LZ4-HC (High compression, fast read)</option>
                      <option value="lz4">LZ4 (Standard high-speed compression)</option>
                      <option value="none">None (Uncompressed sparse layout)</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Partition Mode</label>
                    <select
                      value={newPartReadOnly ? "readonly" : "readwrite"}
                      onChange={(e) => setNewPartReadOnly(e.target.value === "readonly")}
                      className="w-full bg-slate-950/80 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value="readonly">Read-Only Secure Block</option>
                      <option value="readwrite">Read-Write Development Block</option>
                    </select>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Role / Description</label>
                  <input
                    type="text"
                    placeholder="Describe what lives in this partition block..."
                    value={newPartDesc}
                    onChange={(e) => setNewPartDesc(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2 pt-1.5">
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded-lg py-2.5 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Register Logical Partition to Super Block
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* DYNAMIC METADATA CONTROLS */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">3</span>
              Super Block Hardware Alignment Parameters
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Super Capacity (MB)</label>
                <input
                  type="number"
                  value={superCapacityMb}
                  onChange={(e) => setSuperCapacityMb(Math.max(1024, parseInt(e.target.value) || 1024))}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Metadata size (KB)</label>
                <select
                  value={metadataSizeKb}
                  onChange={(e) => setMetadataSizeKb(parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                >
                  <option value={16}>16 KB</option>
                  <option value={32}>32 KB</option>
                  <option value={64}>64 KB (Standard)</option>
                  <option value={128}>128 KB</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Metadata Slots (A/B)</label>
                <select
                  value={metadataSlots}
                  onChange={(e) => setMetadataSlots(parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                >
                  <option value={1}>1 Slot (Non-A/B)</option>
                  <option value={2}>2 Slots (A/B Dual)</option>
                  <option value={4}>4 Slots (Multi-Recovery)</option>
                </select>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: CODING IN THE BACKGROUND (Spans 5 in Split, Full in Single) */}
        <div className={`${isSplitLayout ? 'lg:col-span-5' : 'w-full'} flex flex-col gap-6`}>
          
          {/* TERMINAL LOGS */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-3 border-b border-slate-900 pb-2">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" /> Coding background shell log
              </h3>
              <span className="text-[9.5px] bg-[#0a0d18] text-indigo-400 border border-indigo-500/10 px-2 py-0.5 rounded font-mono">
                {isCompiling ? 'PACKAGING RUNTIME...' : 'IDLE'}
              </span>
            </div>

            {/* Simulated Live Terminal */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 font-mono text-[10.5px] leading-relaxed text-slate-400 h-[220px] overflow-y-auto space-y-1.5 scrollbar-thin">
              {terminalLogs.length > 0 ? (
                terminalLogs.map((log, index) => (
                  <div key={index} className="truncate">
                    <span className="text-indigo-400">BOARD_COMPILE:~$</span> {log}
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center">
                  <Terminal className="w-10 h-10 text-slate-800 mb-2" />
                  <span>Interactive command log is empty.</span>
                  <span className="text-[9.5px] mt-1 text-slate-700">Click "Assemble Super Partition" to compile images.</span>
                </div>
              )}
            </div>
          </div>

          {/* REAL-TIME COMMAND COMPILER CODE BLOCK */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-3 border-b border-slate-900 pb-2">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileCode className="w-4 h-4 text-indigo-400" /> Synthesized AOSP Utensils script
              </h3>
              <div className="relative">
                <button
                  onClick={() => copyToClipboard(selectedUtensil === 'lpmake' ? lpmakeCommand : currentUtensil.example)}
                  className="px-2 py-1 bg-slate-950 hover:bg-slate-900 border border-slate-900 hover:border-slate-800 text-slate-400 hover:text-white rounded text-[10px] font-mono transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" /> {copyFeedback || 'Copy Code'}
                </button>
              </div>
            </div>

            {/* Code visualizer display */}
            <div className="flex-1 flex flex-col justify-between min-h-[380px]">
              <div className="text-[10px] text-slate-500 font-mono mb-2 flex justify-between items-center bg-slate-950/40 p-2 rounded border border-slate-900">
                <span>Active Utensil: <strong>{currentUtensil.name}</strong></span>
                <span>Language: shell bash</span>
              </div>

              <textarea
                readOnly
                className="w-full flex-1 bg-slate-950 text-indigo-300 font-mono text-[10.5px] leading-relaxed resize-none focus:outline-none p-3.5 rounded-xl border border-slate-900 h-[280px]"
                style={{ tabSize: 4 }}
                value={selectedUtensil === 'lpmake' ? lpmakeCommand : currentUtensil.example}
              />

              <div className="mt-4 p-4 bg-indigo-950/10 border border-indigo-500/10 rounded-xl space-y-2">
                <span className="text-[10px] font-bold font-mono text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-400" /> Dynamic Super Partition Rule Book
                </span>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  In AOSP, standard partitions utilize **EROFS** for read-only filesystem compression to save blocks storage space and guarantee hardware-integrity verification via `dm-verity`. Under dynamic partitions layout, individual partition images are packaged inside the dynamic group and compiled into a single flashable `super.img`.
                </p>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
