/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Github, 
  Gitlab, 
  Globe, 
  ShieldAlert, 
  CloudCheck, 
  CheckCircle2, 
  X, 
  RefreshCw, 
  Database, 
  GitCommit, 
  ArrowRight, 
  Terminal, 
  ExternalLink, 
  Sparkles,
  UserCheck,
  ChevronRight,
  Shield,
  Layers,
  Settings2,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GeneratedFile } from '../types';

interface DeveloperConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  activeFiles: GeneratedFile[];
  onExportSession?: () => void;
  onImportSession?: (fileContent: string) => boolean;
  deviceMetadata?: any;
  components?: any[];
  partitions?: any[];
  superCapacityMb?: number;
}

interface UserProfile {
  connected: boolean;
  username: string;
  avatarUrl: string;
  email: string;
  isDemo: boolean;
}

export default function DeveloperConsole({ 
  isOpen, 
  onClose, 
  activeFiles,
  onExportSession,
  onImportSession,
  deviceMetadata,
  components,
  partitions,
  superCapacityMb
}: DeveloperConsoleProps) {
  const [profiles, setProfiles] = useState<{
    github: UserProfile | null;
    gitlab: UserProfile | null;
    google: UserProfile | null;
  }>({
    github: null,
    gitlab: null,
    google: null
  });

  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({
    github_id_configured: false,
    github_secret_configured: false,
    gitlab_id_configured: false,
    gitlab_secret_configured: false,
    google_id_configured: false,
    google_secret_configured: false,
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitLogs, setCommitLogs] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState<string>('feat(aosp): integrate custom ColorSensor HAL service & AIDL rules');
  const [selectedTargetRepo, setSelectedTargetRepo] = useState<string>('aosp-custom-sensor-manifest');
  const [selectedCommitProvider, setSelectedCommitProvider] = useState<'github' | 'gitlab'>('github');
  const [isSandboxMode, setIsSandboxMode] = useState<boolean>(true);
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Fetch initial profile states from the server on open
  const fetchProfiles = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/profile');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles);
        if (data.envStatus) {
          setEnvStatus(data.envStatus);
        }
      }
    } catch (e) {
      console.error('Failed to retrieve profiles:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchProfiles();
    }
  }, [isOpen]);

  // Listen to cross-origin postMessage events back from the popup window callback
  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      // Security: Validate the incoming message source and type
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const { provider, username, avatarUrl, email, isDemo } = event.data;
        setProfiles(prev => ({
          ...prev,
          [provider]: {
            connected: true,
            username,
            avatarUrl,
            email,
            isDemo
          }
        }));
        showToast(`Successfully linked ${provider.toUpperCase()} connection!`, 'success');
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const showToast = (text: string, type: 'success' | 'error') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Trigger popup-based OAuth
  const handleConnectProvider = async (provider: 'github' | 'gitlab' | 'google') => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const urlResponse = await fetch(`/api/auth/url?provider=${provider}&redirect_uri=${encodeURIComponent(redirectUri)}`);
      
      if (!urlResponse.ok) {
        throw new Error('Failed to fetch authorization URL');
      }

      const { url } = await urlResponse.json();

      // Open OAuth provider in popup directly to respect AI Studio frame bounds
      const popupWidth = 600;
      const popupHeight = 700;
      const left = window.screen.width / 2 - popupWidth / 2;
      const top = window.screen.height / 2 - popupHeight / 2;

      const authWindow = window.open(
        url,
        `${provider}_oauth_popup`,
        `width=${popupWidth},height=${popupHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`
      );

      if (!authWindow) {
        showToast('Popup blocker active. Please allow popups to link account.', 'error');
      }
    } catch (err: any) {
      console.error(err);
      showToast('OAuth flow initiation failed.', 'error');
    }
  };

  // Revoke account connection
  const handleDisconnectProvider = async (provider: 'github' | 'gitlab' | 'google') => {
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });

      if (res.ok) {
        setProfiles(prev => ({
          ...prev,
          [provider]: null
        }));
        showToast(`Revoked connection for ${provider.toUpperCase()}.`, 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to revoke session.', 'error');
    }
  };

  // Trigger AOSP files commit & push simulation to connected Git repos
  const handleCommitFiles = async () => {
    const activeProvider = selectedCommitProvider;
    const activeProfile = profiles[activeProvider];

    if (!activeProfile || !activeProfile.connected) {
      showToast(`Please connect a ${activeProvider.toUpperCase()} account first.`, 'error');
      return;
    }

    if (activeFiles.length === 0) {
      showToast('No compiled AOSP code files to commit.', 'error');
      return;
    }

    setIsCommitting(true);
    setCommitLogs(['[*] Starting AOSP system branch integration...', '[*] Gathering compiled workspace components...']);

    try {
      const res = await fetch('/api/auth/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeProvider,
          repository: selectedTargetRepo,
          files: activeFiles.map(f => ({ filename: f.filename, path: f.path })),
          commitMessage
        })
      });

      if (res.ok) {
        const data = await res.json();
        // Stagger logs to make it look incredibly cool & premium
        data.logs.forEach((log: string, index: number) => {
          setTimeout(() => {
            setCommitLogs(prev => [...prev, log]);
            if (index === data.logs.length - 1) {
              setIsCommitting(false);
              showToast(`Committed build safely to remote repository!`, 'success');
            }
          }, (index + 1) * 450);
        });
      } else {
        throw new Error('Push failed.');
      }
    } catch (e) {
      setIsCommitting(false);
      setCommitLogs(prev => [...prev, '[ERROR] Repository commit transaction aborted.']);
      showToast('Git remote push transaction failed.', 'error');
    }
  };

  // Standard environment setup paths
  const devCallbackUrl = `${window.location.origin}/auth/callback`;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop blur overlay */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-100"
          />

          {/* Slide-over Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-[#0a0d19] border-l border-[#1e293b] text-slate-100 shadow-2xl z-101 flex flex-col justify-between overflow-hidden"
          >
            {/* Header section */}
            <div className="p-6 bg-[#111827] border-b border-[#1e293b] flex items-center justify-between">
              <div>
                <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold font-mono rounded-full flex items-center gap-1 w-fit">
                  <Settings2 className="w-3 h-3 animate-spin" /> PROFILES CONSOLE
                </span>
                <h3 className="text-lg font-bold text-white mt-1 flex items-center gap-2">
                  <Database className="text-indigo-500 w-5 h-5" /> Connected Integrations
                </h3>
              </div>
              <button 
                onClick={onClose} 
                className="p-1.5 rounded-lg hover:bg-slate-900 transition-colors text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Center Content */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6 scrollbar-thin scrollbar-thumb-slate-900">
              
              {/* Info Notification Toast */}
              {notification && (
                <div className={`p-3 rounded-xl border text-xs font-semibold font-mono flex items-center gap-2 ${
                  notification.type === 'success' 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}>
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{notification.text}</span>
                </div>
              )}

              {/* SECTION 1: Connect accounts triggers */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-indigo-400" /> Account Integrations
                  </h4>
                  <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-900">
                    <Shield className="w-3 h-3 text-slate-400" />
                    <span>Secure Iframe-safe Popup Protocol</span>
                  </div>
                </div>

                {/* Google Connection Card */}
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-500/5 border border-red-500/15 flex items-center justify-center text-red-400 font-bold font-sans text-lg shadow-inner">
                      G
                    </div>
                    <div>
                      <span className="block font-bold text-xs text-white flex items-center gap-1.5">
                        Google Lead Account
                        {profiles.google?.connected && (
                          <span className="px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 text-[8px] font-bold rounded">Linked</span>
                        )}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {profiles.google?.connected 
                          ? `Linked: ${profiles.google.email}` 
                          : 'Synchronizes your custom AOSP board layouts safely across Cloud sessions.'}
                      </span>
                    </div>
                  </div>

                  <div>
                    {profiles.google?.connected ? (
                      <button
                        onClick={() => handleDisconnectProvider('google')}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] font-bold rounded-lg text-rose-400 transition-colors cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnectProvider('google')}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg transition-all shadow shadow-blue-500/20 flex items-center gap-1 cursor-pointer"
                      >
                        Connect Account <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* GitHub Connection Card */}
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-white">
                      <Github className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="block font-bold text-xs text-white flex items-center gap-1.5">
                        GitHub Profile
                        {profiles.github?.connected && (
                          <span className="px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 text-[8px] font-bold rounded">Linked</span>
                        )}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {profiles.github?.connected 
                          ? `User: @${profiles.github.username}` 
                          : 'Commit system blueprint files directly to public & private repos.'}
                      </span>
                    </div>
                  </div>

                  <div>
                    {profiles.github?.connected ? (
                      <button
                        onClick={() => handleDisconnectProvider('github')}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] font-bold rounded-lg text-rose-400 transition-colors cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnectProvider('github')}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg transition-all shadow shadow-blue-500/20 flex items-center gap-1 cursor-pointer"
                      >
                        Connect Account <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* GitLab Connection Card */}
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/5 border border-orange-500/15 flex items-center justify-center text-orange-400">
                      <Gitlab className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="block font-bold text-xs text-white flex items-center gap-1.5">
                        GitLab Workspace
                        {profiles.gitlab?.connected && (
                          <span className="px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 text-[8px] font-bold rounded">Linked</span>
                        )}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {profiles.gitlab?.connected 
                          ? `User: @${profiles.gitlab.username}` 
                          : 'Push configurations, custom build scripts, and dependencies.'}
                      </span>
                    </div>
                  </div>

                  <div>
                    {profiles.gitlab?.connected ? (
                      <button
                        onClick={() => handleDisconnectProvider('gitlab')}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] font-bold rounded-lg text-rose-400 transition-colors cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnectProvider('gitlab')}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg transition-all shadow shadow-blue-500/20 flex items-center gap-1 cursor-pointer"
                      >
                        Connect Account <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* SECTION 1.5: Session Portability & Workspace Sync */}
              <div className="p-4 bg-gradient-to-tr from-[#0a0f24] to-[#111c3a] border border-blue-500/10 rounded-xl space-y-4">
                <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Database className="text-indigo-400 w-4 h-4" /> Session Workspace Portability
                  </h4>
                  <span className="text-[9px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded font-mono font-bold">
                    JSON Spec v1.4
                  </span>
                </div>

                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Export your entire custom partition tables, AOSP components, and compiled code files to a single JSON file. Resume on any workstation.
                </p>

                <div className="flex flex-col sm:flex-row gap-2">
                  {/* Export Trigger */}
                  <button
                    onClick={onExportSession}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow"
                  >
                    <Download className="w-3.5 h-3.5" /> Export Session
                  </button>

                  {/* Import Trigger */}
                  <div className="flex-1 relative">
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const text = event.target?.result as string;
                          if (onImportSession && onImportSession(text)) {
                            showToast("Workspace imported successfully!", "success");
                          } else {
                            showToast("Invalid session JSON file.", "error");
                          }
                        };
                        reader.readAsText(file);
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      id="import-session-file-input"
                    />
                    <button
                      type="button"
                      className="w-full py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Import Session
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION 2: Active Git commit pushing system */}
              {(profiles.github?.connected || profiles.gitlab?.connected) && (
                <div className="p-4 bg-gradient-to-tr from-slate-950 to-indigo-950/15 border border-[#1e293b]/60 rounded-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                      <GitCommit className="text-indigo-400 w-4 h-4 animate-pulse" /> Interactive Git Committer
                    </h4>
                    <span className="text-[9px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded font-mono font-bold">
                      Active: {activeFiles.length} AOSP files
                    </span>
                  </div>

                  <div className="space-y-3">
                    
                    {/* Commit target provider */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Target Account Endpoint</label>
                      <div className="flex gap-2">
                        {profiles.github?.connected && (
                          <button
                            onClick={() => setSelectedCommitProvider('github')}
                            className={`flex-1 p-2 border rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                              selectedCommitProvider === 'github'
                                ? 'bg-indigo-500/10 border-indigo-500 text-white font-bold'
                                : 'bg-slate-950 border-slate-900 text-slate-400'
                            }`}
                          >
                            <Github className="w-4 h-4" /> GitHub Repo
                          </button>
                        )}
                        {profiles.gitlab?.connected && (
                          <button
                            onClick={() => setSelectedCommitProvider('gitlab')}
                            className={`flex-1 p-2 border rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                              selectedCommitProvider === 'gitlab'
                                ? 'bg-indigo-500/10 border-indigo-500 text-white font-bold'
                                : 'bg-slate-950 border-slate-900 text-slate-400'
                            }`}
                          >
                            <Gitlab className="w-4 h-4" /> GitLab Repo
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Repo Name text */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Destination Repository</label>
                      <input
                        type="text"
                        value={selectedTargetRepo}
                        onChange={(e) => setSelectedTargetRepo(e.target.value)}
                        className="w-full bg-slate-950 border border-[#1e293b] hover:border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none"
                      />
                    </div>

                    {/* Commit message input */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Commit Message</label>
                      <textarea
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        className="w-full bg-slate-950 border border-[#1e293b] hover:border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none h-[60px] resize-none"
                      />
                    </div>

                    {/* Trigger Push btn */}
                    <button
                      onClick={handleCommitFiles}
                      disabled={isCommitting}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-xs transition-all cursor-pointer shadow-lg shadow-indigo-500/15"
                    >
                      {isCommitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GitCommit className="w-4 h-4" />}
                      {isCommitting ? 'Pushing commits to remote...' : 'Commit & Push to Remote Repository'}
                    </button>

                    {/* Progress terminal logging */}
                    {commitLogs.length > 0 && (
                      <div className="pt-2 border-t border-slate-900">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 font-mono block mb-1">Push Logging Terminal</span>
                        <div className="bg-slate-950 p-2 rounded-lg border border-slate-900 font-mono text-[9px] leading-relaxed text-slate-400 h-[100px] overflow-y-auto space-y-1">
                          {commitLogs.map((log, i) => (
                            <div key={i} className="truncate">
                              <span className="text-indigo-400">GIT:</span> {log}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              )}

              {/* SECTION 3: API setup documentation card */}
              <div className="p-4 bg-[#0d1222] border border-blue-500/10 rounded-xl space-y-3">
                <span className="text-[10px] font-bold font-mono text-blue-400 uppercase tracking-widest flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-blue-400" /> OAuth Provider Setup Guide
                </span>
                <p className="text-[11px] text-slate-400 leading-normal">
                  To utilize real provider authentication, configure these environment keys in your settings tab inside AI Studio and register the exact redirect callbacks:
                </p>

                <div className="space-y-2">
                  <div className="p-2 bg-slate-950 rounded border border-slate-900">
                    <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Developer Callback URL</span>
                    <span className="text-[9.5px] font-mono text-blue-300 select-all block break-all bg-[#0a0a14] p-1.5 rounded">{devCallbackUrl}</span>
                  </div>

                  <div className="p-2 bg-slate-950 rounded border border-slate-900">
                    <span className="text-[9px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Required Environment Variables</span>
                    <ul className="text-[9.5px] font-mono text-slate-300 space-y-1 mt-1 pl-1 list-disc list-inside">
                      <li><code>GITHUB_CLIENT_ID</code> / <code>GITHUB_CLIENT_SECRET</code></li>
                      <li><code>GITLAB_CLIENT_ID</code> / <code>GITLAB_CLIENT_SECRET</code></li>
                      <li><code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code></li>
                    </ul>
                  </div>

                  <p className="text-[10px] text-slate-500 leading-normal">
                    💡 **Sandbox Mode:** If keys are unconfigured, clicking link accounts will automatically log in with a high-fidelity mock profile, enabling you to test full commit-to-remote workflows instantly!
                  </p>
                </div>
              </div>

            </div>

            {/* Footer console settings status */}
            <div className="p-6 bg-[#0c1020] border-t border-[#1e293b] flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>Status: <span className="text-emerald-400">ONLINE</span></span>
              <span>Platform Protocol V2</span>
            </div>

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
