/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Upload, 
  UserPlus, 
  Key, 
  Trash2, 
  Layers, 
  Check, 
  Info, 
  AlertTriangle, 
  FileText, 
  Download, 
  ShieldAlert, 
  Database,
  Search,
  FileCheck,
  UserCheck,
  Code,
  Briefcase,
  Share2,
  Copy,
  FolderOpen
} from 'lucide-react';

export interface Person {
  id: string;
  name: string;
  email: string;
  role: 'Platform Architect' | 'HAL Engineer' | 'Security Auditor' | 'Carrier Liaison' | 'Build Approver';
  source: 'Manual' | 'CSV Import' | 'JSON Import' | 'Firmware Signature' | 'AOSP Template';
  fingerprint?: string; // for firmware keys
  assignedPartitions: string[]; // e.g. ['system.img', 'vendor.img', 'boot.img']
  accessLevel: 'Superuser' | 'Write Contexts' | 'Review Only';
}

export default function PeoplesImporter() {
  const [peoples, setPeoples] = useState<Person[]>([
    {
      id: 'usr-1',
      name: 'Android Open Source Project (AOSP) release-keys',
      email: 'android-security@google.com',
      role: 'Security Auditor',
      source: 'AOSP Template',
      fingerprint: 'SHA256: 27:3F:DE:44:A2:91:00:C2:5E:F7:88:B9:4C:D1:D0:A2:7B:A2:C2:FF:10:9D:E1:FF',
      assignedPartitions: ['boot.img', 'vbmeta.img'],
      accessLevel: 'Superuser'
    },
    {
      id: 'usr-2',
      name: 'Linus Torvalds',
      email: 'torvalds@linux-foundation.org',
      role: 'Platform Architect',
      source: 'AOSP Template',
      assignedPartitions: ['boot.img'],
      accessLevel: 'Superuser'
    },
    {
      id: 'usr-3',
      name: 'Qualcomm Driver HAL Team',
      email: 'hal-drivers@qualcomm.com',
      role: 'HAL Engineer',
      source: 'AOSP Template',
      assignedPartitions: ['vendor.img', 'odm.img'],
      accessLevel: 'Write Contexts'
    }
  ]);

  // Form State
  const [newName, setNewName] = useState<string>('');
  const [newEmail, setNewEmail] = useState<string>('');
  const [newRole, setNewRole] = useState<Person['role']>('HAL Engineer');
  const [newAccess, setNewAccess] = useState<Person['accessLevel']>('Write Contexts');
  const [selectedPartition, setSelectedPartition] = useState<string>('system.img');

  // Search/Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // CSV/JSON parsing states
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Copy Feedback
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // Presets available to import with single click
  const carrierSecuritySigners = [
    {
      name: 'T-Mobile Release Keys Authority',
      email: 'device-sig-auth@t-mobile.com',
      role: 'Build Approver' as const,
      source: 'Firmware Signature' as const,
      fingerprint: 'SHA256: 9F:C8:D2:E3:44:A1:00:2B:EE:7C:F9:8E:D1:D0:A2:CC:54:12:F1:FF:8D:C1:2A:BB',
      assignedPartitions: ['product.img', 'super.img'],
      accessLevel: 'Write Contexts' as const
    },
    {
      name: 'Verizon Wireless OTA Signing Key',
      email: 'ota-signing@verizon.com',
      role: 'Build Approver' as const,
      source: 'Firmware Signature' as const,
      fingerprint: 'SHA256: 42:EB:DD:11:A3:C2:AA:77:FF:55:00:8E:12:D0:D0:D2:11:CC:AA:FF:11:BB:EE:33',
      assignedPartitions: ['system.img', 'product.img'],
      accessLevel: 'Write Contexts' as const
    },
    {
      name: 'Samsung Knox Attestation Signer',
      email: 'knox.security@samsung.com',
      role: 'Security Auditor' as const,
      source: 'Firmware Signature' as const,
      fingerprint: 'SHA256: E8:AA:77:00:D1:BB:CC:DD:22:11:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
      assignedPartitions: ['boot.img', 'system.img', 'vendor.img'],
      accessLevel: 'Superuser' as const
    }
  ];

  const handleAddPerson = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) {
      setImportStatus({ success: false, message: 'Please provide both a name and an email address.' });
      return;
    }

    const newPerson: Person = {
      id: `usr-${Date.now()}`,
      name: newName.trim(),
      email: newEmail.trim(),
      role: newRole,
      source: 'Manual',
      assignedPartitions: [selectedPartition],
      accessLevel: newAccess
    };

    setPeoples(prev => [newPerson, ...prev]);
    setNewName('');
    setNewEmail('');
    setImportStatus({ success: true, message: `Successfully added ${newPerson.name} as manual collaborator!` });
  };

  // Import from preset carrier keys (signers)
  const handleImportSigner = (signer: typeof carrierSecuritySigners[0]) => {
    if (peoples.some(p => p.email === signer.email)) {
      setImportStatus({ success: false, message: `Signer "${signer.name}" is already imported in contacts.` });
      return;
    }

    const person: Person = {
      id: `usr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...signer
    };

    setPeoples(prev => [person, ...prev]);
    setImportStatus({ success: true, message: `Imported cryptographic signer authority [${signer.name}] successfully!` });
  };

  // Remove person
  const handleRemovePerson = (id: string) => {
    const target = peoples.find(p => p.id === id);
    setPeoples(prev => prev.filter(p => p.id !== id));
    if (target) {
      setImportStatus({ success: true, message: `Removed collaborator "${target.name}".` });
    }
  };

  // Parse CSV payload in real time (HTML5 FileReader)
  const parseCSVData = (text: string) => {
    try {
      const lines = text.split('\n').filter(line => line.trim() !== '');
      if (lines.length <= 1) {
        throw new Error('CSV has no records or only headers.');
      }

      const importedList: Person[] = [];
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      // Simple CSV parser
      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (columns.length < 2) continue;

        // Map column indices
        const name = columns[0] || 'Unknown Imported';
        const email = columns[1] || 'imported@carrier-realm.com';
        const roleStr = columns[2] || 'HAL Engineer';
        const accessStr = columns[3] || 'Write Contexts';
        const partStr = columns[4] || 'system.img';

        // Cast safely
        let role: Person['role'] = 'HAL Engineer';
        if (['Platform Architect', 'HAL Engineer', 'Security Auditor', 'Carrier Liaison', 'Build Approver'].includes(roleStr)) {
          role = roleStr as Person['role'];
        }

        let accessLevel: Person['accessLevel'] = 'Write Contexts';
        if (['Superuser', 'Write Contexts', 'Review Only'].includes(accessStr)) {
          accessLevel = accessStr as Person['accessLevel'];
        }

        importedList.push({
          id: `csv-${Date.now()}-${i}`,
          name,
          email,
          role,
          source: 'CSV Import',
          assignedPartitions: partStr.split('|'),
          accessLevel
        });
      }

      if (importedList.length === 0) {
        throw new Error('No valid records parsed from CSV columns.');
      }

      setPeoples(prev => [...importedList, ...prev]);
      setImportStatus({ success: true, message: `CSV parsed successfully! Imported ${importedList.length} OS developers.` });
    } catch (err: any) {
      setImportStatus({ success: false, message: `CSV Parsing error: ${err.message || err}` });
    }
  };

  // Parse JSON file
  const parseJSONData = (text: string) => {
    try {
      const obj = JSON.parse(text);
      const list = Array.isArray(obj) ? obj : [obj];
      const parsedList: Person[] = [];

      list.forEach((item, index) => {
        if (!item.name || !item.email) {
          throw new Error(`Record #${index + 1} is missing required 'name' or 'email' keys.`);
        }
        parsedList.push({
          id: `json-${Date.now()}-${index}`,
          name: String(item.name),
          email: String(item.email),
          role: (item.role || 'HAL Engineer') as Person['role'],
          source: 'JSON Import',
          assignedPartitions: Array.isArray(item.assignedPartitions) ? item.assignedPartitions.map(String) : ['system.img'],
          accessLevel: (item.accessLevel || 'Write Contexts') as Person['accessLevel'],
          fingerprint: item.fingerprint ? String(item.fingerprint) : undefined
        });
      });

      setPeoples(prev => [...parsedList, ...prev]);
      setImportStatus({ success: true, message: `JSON Config parsed! Imported ${parsedList.length} secure contacts.` });
    } catch (err: any) {
      setImportStatus({ success: false, message: `JSON Format error: ${err.message || err}` });
    }
  };

  // File loading router
  const handleFileDropOrSelect = (files: FileList) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (file.name.endsWith('.csv')) {
        parseCSVData(text);
      } else if (file.name.endsWith('.json')) {
        parseJSONData(text);
      } else {
        setImportStatus({ success: false, message: 'Unsupported extension. Please upload a valid .csv or .json team file.' });
      }
    };

    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileDropOrSelect(e.target.files);
    }
  };

  // Drag over files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFileDropOrSelect(e.dataTransfer.files);
    }
  };

  // Export people to clean json
  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(peoples, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "any_realm_peoples_config.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setImportStatus({ success: true, message: 'Exported contacts JSON package!' });
  };

  // Filter peoples
  const filteredPeoples = peoples.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        p.role.toLowerCase().includes(searchTerm.toLowerCase());
    const matchSource = sourceFilter === 'all' || p.source === sourceFilter;
    return matchSearch && matchSource;
  });

  return (
    <div className="flex flex-col gap-8" id="peoples-importer-workspace-root">
      
      {/* 1. COMPONENT TITLE BANNER */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Users className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Users className="w-3.5 h-3.5 animate-pulse" /> Platform Collaborators
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <Users className="text-indigo-500 w-7 h-7" /> Peoples & Signature Importer
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Import firmware security signers, parse CSV/JSON team lists, map system developers to logical partitions (`system.img`, `boot.img`), and establish code owners for Any RealM AOSP builds.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleExportJson}
              className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-white text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" /> Export Config
            </button>
          </div>
        </div>
      </div>

      {/* 2. MAIN GRID LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* LEFT COLUMN: INGEST CHANNELS (CSV/JSON File Reader + manual additions) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">
          
          {/* CSV/JSON DRAG AND DROP PORTAL */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-4.5 h-4.5 text-indigo-400" /> Import People Lists (CSV / JSON)
              </h3>
              <span className="text-[9.5px] font-mono text-slate-500 font-bold">REAL FILE PARSER</span>
            </div>

            <p className="text-xs text-slate-400 leading-normal mb-4">
              Upload standard developer maps. The system parses your contact profiles, mapped build roles, and partition assignments on-the-fly.
            </p>

            {/* Ingest Box */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer flex flex-col items-center justify-center min-h-[140px] ${
                isDragging 
                  ? 'border-indigo-500 bg-indigo-500/5' 
                  : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              <input
                type="file"
                id="people-list-file-input"
                className="hidden"
                accept=".csv,.json"
                onChange={handleFileChange}
              />
              <label htmlFor="people-list-file-input" className="cursor-pointer flex flex-col items-center">
                <Upload className="w-10 h-10 text-indigo-400/80 mb-2" />
                <span className="text-xs font-bold text-white">Drop developer map file or Click to Browse</span>
                <span className="text-[9px] text-slate-500 block mt-1 font-mono">Supports .csv or .json team lists</span>
              </label>
            </div>

            {/* CSV Template Guidelines */}
            <div className="mt-4 p-3 bg-slate-950 rounded-xl border border-slate-900 flex justify-between items-center text-[10px] font-mono text-slate-500">
              <span className="text-slate-400 font-bold">CSV Layout Headers:</span>
              <span className="text-indigo-400">name, email, role, accessLevel, partitions</span>
            </div>
          </div>

          {/* ADD INDIVIDUAL DEVELOPER MANUALLY */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex-1 mt-6">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <UserPlus className="w-4.5 h-4.5 text-indigo-400" /> Individual Collaborator Entry (GUI)
              </h3>
              <span className="text-[9.5px] font-mono text-slate-500 font-bold">MANUAL</span>
            </div>

            <form onSubmit={handleAddPerson} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Jean-Baptiste"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. jb@android.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Collaborator Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="Platform Architect">Platform Architect</option>
                    <option value="HAL Engineer">HAL Engineer</option>
                    <option value="Security Auditor">Security Auditor</option>
                    <option value="Carrier Liaison">Carrier Liaison</option>
                    <option value="Build Approver">Build Approver</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Terminal Security Authorization</label>
                  <select
                    value={newAccess}
                    onChange={(e) => setNewAccess(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="Superuser">Superuser root (All actions)</option>
                    <option value="Write Contexts">Write permissions</option>
                    <option value="Review Only">Reviewer only (Read-only)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Assigned Partition Ownership</label>
                <select
                  value={selectedPartition}
                  onChange={(e) => setSelectedPartition(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-900 rounded-lg p-2 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="system.img">system.img (Platform core)</option>
                  <option value="vendor.img">vendor.img (Drivers/HALs)</option>
                  <option value="product.img">product.img (Carrier apps)</option>
                  <option value="boot.img">boot.img (Kernel & ramdisk)</option>
                  <option value="vbmeta.img">vbmeta.img (AVB crypt-hashes)</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg text-xs transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add Collaborator
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: ACTIVE CONTACTS LIST & CRYPTO SIGNER INJECTORS */}
        <div className="lg:col-span-7 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-900 pb-3 mb-4 gap-3">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <UserCheck className="w-4.5 h-4.5 text-indigo-400" /> Active Any RealM Collaborator Index ({filteredPeoples.length})
                </h3>
                <span className="text-xs text-slate-500 block mt-0.5">Filter, review, and configure developer credentials dynamically.</span>
              </div>

              {/* Status Feedbacks */}
              {importStatus && (
                <div className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold flex items-center gap-1.5 border ${
                  importStatus.success 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}>
                  {importStatus.success ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  <span className="truncate max-w-[180px]">{importStatus.message}</span>
                </div>
              )}
            </div>

            {/* Search filter row */}
            <div className="flex gap-2.5 mb-4">
              <div className="flex bg-[#0a0d18] border border-slate-900 rounded-lg p-0.5 flex-1">
                <span className="pl-3 pr-1 text-slate-500 flex items-center">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  placeholder="Search collaborators..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-transparent border-0 text-xs text-slate-200 py-1.5 focus:outline-none placeholder-slate-600"
                />
              </div>

              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="bg-[#0a0d18] border border-slate-900 rounded-lg px-2 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">All Sources</option>
                <option value="Manual">Manual Entry</option>
                <option value="CSV Import">CSV Imports</option>
                <option value="JSON Import">JSON Imports</option>
                <option value="Firmware Signature">Firmware Keys</option>
                <option value="AOSP Template">Core Templates</option>
              </select>
            </div>

            {/* List block */}
            <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin">
              {filteredPeoples.length > 0 ? (
                filteredPeoples.map((person) => (
                  <div 
                    key={person.id}
                    className="p-3.5 bg-[#0b0f19] rounded-xl border border-slate-900 hover:border-slate-850 transition-all flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-xs text-white">{person.name}</span>
                        <span className="text-[8.5px] font-mono px-1.5 py-0.2 bg-[#121b2d] border border-slate-800 text-slate-400 rounded">
                          {person.role}
                        </span>
                        
                        <span className={`text-[8px] font-mono font-bold px-1 py-0.2 rounded uppercase ${
                          person.accessLevel === 'Superuser' 
                            ? 'bg-rose-500/10 text-rose-400' 
                            : person.accessLevel === 'Write Contexts' 
                              ? 'bg-indigo-500/10 text-indigo-400' 
                              : 'bg-slate-800 text-slate-400'
                        }`}>
                          {person.accessLevel}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                        <span>Email: <strong className="text-slate-300">{person.email}</strong></span>
                        <span>•</span>
                        <span>Source: <strong className="text-indigo-400">{person.source}</strong></span>
                      </div>

                      {/* Cryptographic fingerprint indicator */}
                      {person.fingerprint && (
                        <div className="p-1.5 bg-[#050811] rounded border border-slate-900 flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                          <Key className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span className="truncate">{person.fingerprint}</span>
                        </div>
                      )}

                      {/* Partition Badges */}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {person.assignedPartitions.map((part) => (
                          <span 
                            key={part} 
                            className="text-[8.5px] font-mono px-1.5 py-0.2 bg-indigo-500/5 text-indigo-300 rounded-md border border-indigo-500/10"
                          >
                            {part}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemovePerson(person.id)}
                      className="p-1.5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded-lg transition-all"
                      title="Remove Collaborator"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="h-[120px] bg-[#0b0f19]/30 rounded-xl border border-slate-900 flex flex-col items-center justify-center text-slate-600 text-center text-xs">
                  <Users className="w-10 h-10 text-slate-800 mb-1" />
                  <span>No collaborators found matching the current search query.</span>
                </div>
              )}
            </div>
          </div>

          {/* DYNAMIC SIGNERS DISCOVERY (Derived from Stock Partition Seals) */}
          <div className="pt-4 border-t border-slate-900/80 mt-5">
            <span className="text-[10px] font-bold uppercase font-mono text-slate-400 tracking-wider block mb-2.5">
              Sift Security Signers from Stock Firmware partitions
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {carrierSecuritySigners.map((signer, index) => {
                const alreadyExists = peoples.some(p => p.email === signer.email);
                return (
                  <div 
                    key={index} 
                    className={`p-3 bg-[#0b0f19] rounded-xl border border-slate-900/60 flex flex-col justify-between h-[110px] ${
                      alreadyExists ? 'opacity-50' : 'hover:border-indigo-500/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                        <span className="flex items-center gap-1"><Key className="w-2.5 h-2.5 text-indigo-400" /> PKCS#7 Key</span>
                        <span>{alreadyExists ? 'Imported' : 'Discovered'}</span>
                      </div>
                      <span className="font-bold text-xs text-white block mt-1 truncate">{signer.name}</span>
                    </div>

                    <button
                      disabled={alreadyExists}
                      onClick={() => handleImportSigner(signer)}
                      className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-all text-center cursor-pointer ${
                        alreadyExists 
                          ? 'bg-slate-900 border border-slate-850 text-slate-600 cursor-not-allowed' 
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                      }`}
                    >
                      {alreadyExists ? 'Already in workspace' : 'Import Authority'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
