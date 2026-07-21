/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  GitBranch, 
  GitCommit, 
  FileCode, 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  Cpu, 
  Wrench, 
  ShieldCheck, 
  Download, 
  Sparkles, 
  Code,
  Check,
  RotateCw,
  Terminal,
  FileCheck,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LaboratoryFile {
  id: string;
  filename: string;
  path: string;
  description: string;
  baseContent: string;
}

interface MutationOption {
  id: string;
  name: string;
  description: string;
  linesAdded: string[];
  linesRemoved: string[];
  vtsScoreImpact: number;
  isStable: boolean;
  hazardType?: 'permissive' | 'overflow' | 'none';
}

const labFiles: LaboratoryFile[] = [
  {
    id: 'colorsensor_driver',
    filename: 'colorsensor_driver.c',
    path: 'drivers/gpu/drm/colorsensor/colorsensor_driver.c',
    description: 'Linux GKI platform kernel character device driver interacting with custom sensory physical layers.',
    baseContent: `#include <linux/module.h>
#include <linux/init.h>
#include <linux/i2c.h>
#include <linux/uaccess.h>

static int colorsensor_probe(struct i2c_client *client) {
    pr_info("colorsensor: probing GKI bus channels\\n");
    return 0;
}

static void colorsensor_remove(struct i2c_client *client) {
    pr_info("colorsensor: driver detached\\n");
}
`
  },
  {
    id: 'colorsensor_service',
    filename: 'ColorSensorService.java',
    path: 'frameworks/base/services/core/java/com/android/server/colorsensor/ColorSensorService.java',
    description: 'AOSP framework IPC service implementing AIDL interface with binder security context validations.',
    baseContent: `package com.android.server.colorsensor;

import android.content.Context;
import android.os.Binder;
import android.util.Slog;

public final class ColorSensorService extends IColorSensor.Stub {
    private final Context mContext;

    public ColorSensorService(Context context) {
        mContext = context;
    }

    public int[] getLatestColorData() {
        return new int[]{255, 255, 255};
    }
}
`
  },
  {
    id: 'colorsensor_sepolicy',
    filename: 'colorsensor.te',
    path: 'system/sepolicy/public/colorsensor.te',
    description: 'SELinux mandatory access control policy file describing platform domain interactions.',
    baseContent: `type colorsensor, domain;
type colorsensor_exec, exec_type, file_type, system_file_type;

binder_use(colorsensor)
binder_call(colorsensor, system_server)
`
  }
];

const mutationOptions: MutationOption[] = [
  {
    id: 'gki_align',
    name: 'Optimize GKI Memory Page Alignment',
    description: 'Forces strict 4KB memory boundary alignment in the sensory input cache buffers.',
    linesAdded: [
      '    // Enforce GKI 2.0 Page alignment boundary for direct memory mapping',
      '    #define GKI_PAGE_ALIGN(addr) ALIGN(addr, 4096)',
      '    pr_info("colorsensor: direct GKI allocation aligned at 4KB physical boundary\\n");'
    ],
    linesRemoved: [
      '    pr_info("colorsensor: probing GKI bus channels\\n");'
    ],
    vtsScoreImpact: 5,
    isStable: true,
    hazardType: 'none'
  },
  {
    id: 'watchdog_guard',
    name: 'Inject High-Frequency Hardware Watchdog',
    description: 'Establishes low-level watchdog thread to prevent locking inside sensory driver interrupts.',
    linesAdded: [
      '    // Safeguard system locks with low-latency hardware registers heartbeat',
      '    mod_timer(&watchdog_timer, jiffies + msecs_to_jiffies(100));',
      '    Slog.d("ColorSensorService", "Watchdog thread registers active heartbeat.");'
    ],
    linesRemoved: [],
    vtsScoreImpact: 3,
    isStable: true,
    hazardType: 'none'
  },
  {
    id: 'unsafe_selinux',
    name: 'Inject Permissive SELinux Security Rule (Unstable)',
    description: 'Allows custom sensory processes to write raw physical device sockets in system domain.',
    linesAdded: [
      '    # Allow unsafe raw terminal writing to debug physical hardware registers directly',
      '    allow colorsensor system_file:file rw_file_perms;',
      '    allow colorsensor self:capability { sys_admin sys_rawio }; # CRITICAL SECURITY GAP'
    ],
    linesRemoved: [],
    vtsScoreImpact: -45,
    isStable: false,
    hazardType: 'permissive'
  },
  {
    id: 'heap_bypass',
    name: 'Bypass JVM Boundary Heap Sizer (Hazardous)',
    description: 'Overwrites AOSP frameworks memory buffer bounds without CTS capability check.',
    linesAdded: [
      '    // High-speed unsafe direct heap memory mapping',
      '    long unsafePtr = sun.misc.Unsafe.getUnsafe().allocateMemory(2048 * 1024);',
      '    sun.misc.Unsafe.getUnsafe().copyMemory(src, unsafePtr, 2048 * 1024);'
    ],
    linesRemoved: [
      '    return new int[]{255, 255, 255};'
    ],
    vtsScoreImpact: -60,
    isStable: false,
    hazardType: 'overflow'
  }
];

export default function ExperimentalLaboratory() {
  const [selectedFileId, setSelectedFileId] = useState<string>('colorsensor_driver');
  const [activeMutations, setActiveMutations] = useState<string[]>([]);
  const [isPatchPromoted, setIsPatchPromoted] = useState<boolean>(false);
  const [isPromoting, setIsPromoting] = useState<boolean>(false);
  const [promotionLogs, setPromotionLogs] = useState<string[]>([]);
  const [generatedPatch, setGeneratedPatch] = useState<string>('');

  const activeFile = labFiles.find(f => f.id === selectedFileId) || labFiles[0];

  // Calculate Git Diffs dynamically based on active mutations
  const calculateDiff = () => {
    let originalLines = activeFile.baseContent.split('\n');
    let addedLinesList: string[] = [];
    let removedLinesList: string[] = [];

    // Find mutations affecting this specific file type/context
    mutationOptions.forEach(opt => {
      if (!activeMutations.includes(opt.id)) return;
      
      // Map mutations to relevant files based on file extension
      const isKernelMutation = opt.id === 'gki_align' || opt.id === 'watchdog_guard';
      const isJavaMutation = opt.id === 'watchdog_guard' || opt.id === 'heap_bypass';
      const isSepolicyMutation = opt.id === 'unsafe_selinux';

      if (activeFile.filename.endsWith('.c') && isKernelMutation) {
        addedLinesList.push(...opt.linesAdded);
        removedLinesList.push(...opt.linesRemoved);
      }
      if (activeFile.filename.endsWith('.java') && isJavaMutation) {
        addedLinesList.push(...opt.linesAdded);
        removedLinesList.push(...opt.linesRemoved);
      }
      if (activeFile.filename.endsWith('.te') && isSepolicyMutation) {
        addedLinesList.push(...opt.linesAdded);
        removedLinesList.push(...opt.linesRemoved);
      }
    });

    // Generate simulated git diff output blocks
    let diffLines: Array<{ type: 'base' | 'add' | 'remove'; text: string }> = [];

    originalLines.forEach(line => {
      const isRemoved = removedLinesList.some(r => line.includes(r.trim()));
      if (isRemoved) {
        diffLines.push({ type: 'remove', text: `- ${line}` });
      } else {
        diffLines.push({ type: 'base', text: `  ${line}` });
        
        // Inject additions where appropriate
        if (line.includes('probe') && addedLinesList.some(a => a.includes('GKI_PAGE_ALIGN'))) {
          const gkiAdditions = addedLinesList.filter(a => a.includes('GKI') || a.includes('ALIGN'));
          gkiAdditions.forEach(add => diffLines.push({ type: 'add', text: `+ ${add}` }));
        }
        if (line.includes('probe') && addedLinesList.some(a => a.includes('watchdog_timer')) && activeFile.filename.endsWith('.c')) {
          const watchdogAdditions = addedLinesList.filter(a => a.includes('watchdog'));
          watchdogAdditions.forEach(add => diffLines.push({ type: 'add', text: `+ ${add}` }));
        }
        if (line.includes('Context') && addedLinesList.some(a => a.includes('Watchdog')) && activeFile.filename.endsWith('.java')) {
          diffLines.push({ type: 'add', text: `+         Slog.d("ColorSensorService", "Watchdog thread registers active heartbeat.");` });
        }
        if (line.includes('getLatestColorData') && addedLinesList.some(a => a.includes('sun.misc.Unsafe'))) {
          diffLines.push({ type: 'add', text: `+         long unsafePtr = sun.misc.Unsafe.getUnsafe().allocateMemory(2048 * 1024);` });
          diffLines.push({ type: 'add', text: `+         sun.misc.Unsafe.getUnsafe().copyMemory(src, unsafePtr, 2048 * 1024);` });
        }
      }
    });

    // If sepolicy file and sepolicy mutation is active
    if (activeFile.filename.endsWith('.te') && addedLinesList.length > 0) {
      addedLinesList.forEach(add => diffLines.push({ type: 'add', text: `+ ${add}` }));
    }

    return diffLines;
  };

  const diffOutput = calculateDiff();

  // Metrics calculations
  const totalDeltas = mutationOptions.filter(o => activeMutations.includes(o.id)).length;
  const linesAddedCount = mutationOptions
    .filter(o => activeMutations.includes(o.id))
    .reduce((acc, curr) => acc + curr.linesAdded.length, 0);
  const linesDeletedCount = mutationOptions
    .filter(o => activeMutations.includes(o.id))
    .reduce((acc, curr) => acc + curr.linesRemoved.length, 0);

  // Dynamic stability score
  const baseScore = 100;
  const scoreMod = mutationOptions
    .filter(o => activeMutations.includes(o.id))
    .reduce((acc, curr) => acc + curr.vtsScoreImpact, 0);
  const stabilityScore = Math.max(0, Math.min(100, baseScore + scoreMod));

  // Determine safety ribbon parameters
  let ribbonStatus: 'stable' | 'warning' | 'danger' = 'stable';
  let ribbonText = 'STABILITY STATUS: VERIFIED - Passes CTS / VTS & GKI Compatibility checks';
  
  if (mutationOptions.filter(o => activeMutations.includes(o.id)).some(o => o.hazardType === 'permissive')) {
    ribbonStatus = 'warning';
    ribbonText = 'STABILITY METRICS COMPROMISED: Permissive SELinux contexts detected (CTS-VTS Fail Risk)';
  } else if (mutationOptions.filter(o => activeMutations.includes(o.id)).some(o => o.hazardType === 'overflow')) {
    ribbonStatus = 'danger';
    ribbonText = 'STABILITY CRITICAL CRASH HAZARD: Direct Memory Heap Overrun threat identified (Boot Loop Hazard)';
  } else if (totalDeltas > 0) {
    ribbonText = `STABILITY STATUS: TESTING ACTIVE (${stabilityScore}% Stability Coef - Perfect GKI Alignment)`;
  }

  const toggleMutation = (id: string) => {
    setActiveMutations(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
    setIsPatchPromoted(false);
    setGeneratedPatch('');
  };

  // Simulate Git format-patch Promotion
  const handlePromotePatch = () => {
    if (isPromoting || totalDeltas === 0) return;
    setIsPromoting(true);
    setPromotionLogs([
      `[*] Initializing Git out-of-tree staging pipeline...`,
      `[*] Fetching upstream branch anchor reference...`,
      `[ANCHOR]: Checked out pristine target 'aosp-android13-gki-5.15' branch.`,
      `[*] Creating temporary testing workspace branch 'experimental-stage-run'...`,
      `$ git checkout -b experimental-stage-run`
    ]);

    const activeMutsText = mutationOptions
      .filter(o => activeMutations.includes(o.id))
      .map(o => `   - Applied: ${o.name}`)
      .join('\n');

    const rawPatchContent = `From d9f2a7b8e5c3a4f1073822f392bb099991a7bc81 Mon Sep 17 00:00:00 2001
From: Any Realm Platform Architect <architect@anyrealm.com>
Date: Mon, 20 Jul 2026 17:35:10 -0700
Subject: [PATCH] security: hardware-alignment: integrate out-of-tree sensory safeguards

This stable patch consolidates verified mutations from the Experimental Laboratory Workspace:
${activeMutsText}

Signed-off-by: Any Realm Platform Architect <architect@anyrealm.com>
---
 drivers/gpu/drm/colorsensor/colorsensor_driver.c | 12 +++++++++-
 frameworks/base/services/core/java/ColorSensorService.java | 8 +++++
 2 files changed, 19 insertions(+), 1 deletion(-)

diff --git a/drivers/gpu/drm/colorsensor/colorsensor_driver.c b/drivers/gpu/drm/colorsensor/colorsensor_driver.c
index a3f829c..f9c2a8b 100644
--- a/drivers/gpu/drm/colorsensor/colorsensor_driver.c
+++ b/drivers/gpu/drm/colorsensor/colorsensor_driver.c
@@ -21,6 +21,12 @@ static int colorsensor_probe(struct i2c_client *client) {
+    // Enforce GKI 2.0 Page alignment boundary
+    #define GKI_PAGE_ALIGN(addr) ALIGN(addr, 4096)
+    pr_info("colorsensor: direct GKI allocation aligned at 4KB physical boundary\\n");
-    pr_info("colorsensor: probing GKI bus channels\\n");
     return 0;
 }`;

    setTimeout(() => {
      setPromotionLogs(prev => [...prev, `[*] Analyzing file mutations inside simulated FS listener...`]);
    }, 400);

    setTimeout(() => {
      setPromotionLogs(prev => [
        ...prev,
        `[FS]: Identified changes inside active laboratory tree:`,
        `  -> MODIFIED: ${activeFile.path}`
      ]);
    }, 800);

    setTimeout(() => {
      setPromotionLogs(prev => [
        ...prev,
        `[*] Staging files and creating commit vector...`,
        `$ git add ${activeFile.path}`,
        `$ git commit -m "feat(colorsensor): apply lab mutations for ${activeFile.filename}"`
      ]);
    }, 1200);

    setTimeout(() => {
      setPromotionLogs(prev => [
        ...prev,
        `[*] Invoking AOSP git-format-patch assembler...`,
        `$ git format-patch -1 -o ./patches/ HEAD`,
        `[SUCCESS]: Created system-compliant patch file: ./patches/0001-sensory-safeguards.patch`,
        `[PIPELINE COMPLETE]: Patch staging engine successfully locked and archived.`
      ]);
      setGeneratedPatch(rawPatchContent);
      setIsPromoting(false);
      setIsPatchPromoted(true);
    }, 1800);
  };

  const downloadPatchFile = () => {
    const element = document.createElement("a");
    const file = new Blob([generatedPatch], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = "0001-experimental-laboratory-safeguards.patch";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="flex flex-col gap-8" id="experimental-lab-workspace-root">
      
      {/* HEADER CARD */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <GitBranch className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Out-of-Tree Integration Lab
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <GitBranch className="text-blue-500 w-7 h-7" /> Experimental Upstream & Out-of-Tree Tester
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Simulate real-time file-system mutations, audit code compliance against strict GKI/CTS constraints, and promote stable modules into format-patch blocks (.patch) directly from the dashboard.
            </p>
          </div>
        </div>
      </div>

      {/* DYNAMIC STABILITY RIBBON */}
      <div className={`p-4 rounded-xl border font-bold text-xs tracking-wide transition-all duration-300 flex items-center justify-between shadow-lg ${
        ribbonStatus === 'stable' 
          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400 shadow-emerald-950/5' 
          : ribbonStatus === 'warning'
            ? 'bg-amber-950/20 border-amber-500/30 text-amber-400 shadow-amber-950/5 animate-pulse'
            : 'bg-rose-950/25 border-rose-500/30 text-rose-400 shadow-rose-950/5 animate-pulse border-2'
      }`}>
        <div className="flex items-center gap-2.5">
          {ribbonStatus === 'stable' ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          )}
          <span>{ribbonText}</span>
        </div>
        {totalDeltas > 0 && (
          <div className="flex items-center gap-4 text-[10.5px] font-mono">
            <span>CTS COMPLIANCE: {ribbonStatus === 'danger' ? 'FAIL' : 'PASS'}</span>
            <span>STABILITY INDEX: {stabilityScore}%</span>
          </div>
        )}
      </div>

      {/* LAB GRID LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COMPILER PANEL (MUTATIONS AND CHECKS) - Spans 5 */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* MUTATIONS CONTROLLER PANEL */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3.5 border-b border-slate-900 pb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Wrench className="w-4.5 h-4.5 text-blue-400" /> Staged Laboratory Mutations
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Select vectors to inject</span>
            </h3>

            <div className="space-y-3">
              {mutationOptions.map(opt => {
                const isActive = activeMutations.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleMutation(opt.id)}
                    className={`w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-1.5 ${
                      isActive 
                        ? opt.isStable 
                          ? 'bg-blue-600/10 border-blue-500 text-white shadow'
                          : 'bg-rose-600/10 border-rose-500/30 text-white shadow'
                        : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-bold text-xs flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          isActive 
                            ? opt.isStable ? 'bg-blue-400 animate-pulse' : 'bg-rose-400 animate-ping'
                            : 'bg-slate-800'
                        }`} />
                        {opt.name}
                      </span>
                      <span className={`text-[9.5px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                        opt.isStable 
                          ? 'bg-emerald-500/10 text-emerald-400' 
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {opt.isStable ? 'Stable' : 'Hazardous'}
                      </span>
                    </div>
                    <span className="text-[10.5px] text-slate-400 leading-normal pl-4.5">{opt.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* REAL-TIME DELTA METRICS CARD */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3.5 border-b border-slate-900 pb-2.5 flex items-center gap-2">
              <Activity className="w-4.5 h-4.5 text-blue-400" /> Laboratory Workspace Metrics
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                <span className="text-[10px] text-slate-500 uppercase font-mono tracking-tight block">File system Deltas</span>
                <span className="text-xl font-bold text-white font-mono mt-1 block">{totalDeltas} active</span>
              </div>
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                <span className="text-[10px] text-slate-500 uppercase font-mono tracking-tight block">Stability Index</span>
                <span className={`text-xl font-bold font-mono mt-1 block ${
                  stabilityScore >= 90 ? 'text-emerald-400' : stabilityScore >= 70 ? 'text-amber-400' : 'text-rose-400'
                }`}>{stabilityScore}%</span>
              </div>
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                <span className="text-[10px] text-slate-500 uppercase font-mono tracking-tight block">Lines Staged (+)</span>
                <span className="text-xl font-bold text-emerald-400 font-mono mt-1 block">+{linesAddedCount}</span>
              </div>
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-900">
                <span className="text-[10px] text-slate-500 uppercase font-mono tracking-tight block">Lines Purged (-)</span>
                <span className="text-xl font-bold text-rose-400 font-mono mt-1 block">-{linesDeletedCount}</span>
              </div>
            </div>
          </div>

          {/* STAGE & PROMOTION ENGINE CONTROLLER */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-4.5 h-4.5 text-blue-400" /> Stable Patch Promotion Engine
              </h3>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                If the Stability index remains validated above 75%, you can automatically trigger `git format-patch` to export modifications cleanly into the Board tree.
              </p>
            </div>

            <button
              onClick={handlePromotePatch}
              disabled={isPromoting || totalDeltas === 0 || stabilityScore < 75}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:opacity-40 text-white font-bold py-3 rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-blue-500/15"
            >
              {isPromoting ? <RotateCw className="w-4 h-4 animate-spin" /> : <GitCommit className="w-4 h-4" />}
              {isPromoting ? 'Running Staging Pipeline...' : 'Stage & Promote Stable System Patch'}
            </button>

            {stabilityScore < 75 && totalDeltas > 0 && (
              <div className="p-3 bg-rose-500/10 rounded-lg border border-rose-500/20 text-[10.5px] text-rose-400 flex items-start gap-2 leading-relaxed">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span><strong>Promotion Locked:</strong> Stability rating is currently {stabilityScore}%. Remove critical security and memory heap bypass hazards to meet AOSP compliance limits.</span>
              </div>
            )}
          </div>

        </div>

        {/* RIGHT DIFFING VIEW (REAL-TIME GIT DIFF MATRIX) - Spans 7 */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* FILE TABS */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex-1 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 border-b border-slate-900 pb-2.5">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileCode className="w-4.5 h-4.5 text-blue-400" /> Real-time Git Diff Tracking Matrix
              </h3>
              <span className="text-[10px] bg-slate-950 text-blue-400 border border-blue-500/10 px-2 py-0.5 rounded font-mono">
                $ git diff HEAD
              </span>
            </div>

            {/* Selected File Tabs selector */}
            <div className="flex flex-wrap gap-2 mb-4">
              {labFiles.map(file => (
                <button
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer ${
                    selectedFileId === file.id
                      ? 'bg-blue-600/10 border-blue-500 text-white shadow'
                      : 'bg-slate-950 border-slate-900 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {file.filename}
                </button>
              ))}
            </div>

            {/* Description block */}
            <div className="text-[10px] text-slate-400 font-mono mb-2 flex justify-between items-center bg-slate-950/40 p-2.5 rounded border border-slate-900">
              <span className="truncate">File: <strong>{activeFile.path}</strong></span>
              <span className="shrink-0 text-slate-500 uppercase">{activeFile.filename.split('.').pop()} code</span>
            </div>

            {/* Custom Interactive Diff Content Viewer */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 font-mono text-[10.5px] leading-relaxed text-slate-300 min-h-[300px] max-h-[380px] overflow-y-auto space-y-0.5 scrollbar-thin">
              {diffOutput.map((line, i) => (
                <div 
                  key={i} 
                  className={`px-2 py-0.5 rounded transition-all truncate ${
                    line.type === 'add' 
                      ? 'bg-emerald-950/30 text-emerald-400 font-semibold border-l-2 border-emerald-500' 
                      : line.type === 'remove' 
                        ? 'bg-rose-950/35 text-rose-400 font-semibold border-l-2 border-rose-500 line-through' 
                        : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {line.text}
                </div>
              ))}
            </div>
          </div>

          {/* ACTIVE PIPELINE STAGING LOGS */}
          {promotionLogs.length > 0 && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-1.5 font-mono">
                  <Terminal className="w-4 h-4 text-blue-400" /> Staging logs terminal
                </h3>
                <span className="text-[9px] bg-slate-950 text-blue-400 px-2 py-0.5 rounded font-mono">
                  {isPromoting ? 'EXECUTING...' : 'FINISHED'}
                </span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-900 font-mono text-[10px] leading-relaxed text-slate-400 h-[120px] overflow-y-auto space-y-1 scrollbar-thin">
                {promotionLogs.map((log, idx) => (
                  <div key={idx} className="truncate">
                    <span className="text-blue-500">LAB_STAGING:~$</span> {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GENERATED SYSTEM PATCH FILE VIEWER */}
          {isPatchPromoted && generatedPatch && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col">
              <div className="flex items-center justify-between mb-3 border-b border-slate-900 pb-2.5">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <FileCheck className="w-4.5 h-4.5 text-emerald-400" /> Promoted Stable Patch (0001-sensory-safeguards.patch)
                </h3>
                <button
                  onClick={downloadPatchFile}
                  className="px-2.5 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 hover:text-white border border-emerald-500/20 rounded-lg text-[10.5px] font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <Download className="w-3.5 h-3.5" /> Download Patch
                </button>
              </div>

              <textarea
                readOnly
                className="w-full h-[220px] bg-slate-950 text-emerald-300 font-mono text-[10px] leading-relaxed p-4 rounded-xl border border-slate-900 resize-none focus:outline-none"
                value={generatedPatch}
              />
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
