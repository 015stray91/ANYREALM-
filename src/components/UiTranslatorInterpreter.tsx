/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Languages, 
  ShieldCheck, 
  Sparkles, 
  Terminal, 
  Tv, 
  Wrench, 
  Sliders, 
  Play, 
  RefreshCw, 
  Copy, 
  Check, 
  Plus, 
  Trash2, 
  Key, 
  Cpu, 
  Eye, 
  Code,
  Layout,
  Palette,
  Binary,
  Lock,
  Workflow,
  MousePointerClick
} from 'lucide-react';

interface LanguageString {
  id: string;
  key: string;
  en: string;
  targetLang: string; // User-input translation
  category: 'system_ui' | 'hal_errors' | 'bootloader' | 'recovery';
}

interface TrustCertificate {
  id: string;
  alias: string;
  fingerprint: string;
  algorithm: 'RSA-4096' | 'ECDSA-P384' | 'Ed25519';
  scope: 'super_partition' | 'dm_verity' | 'ota_payload';
  status: 'trusted' | 'revoked' | 'unverified';
}

interface UiWidget {
  id: string;
  label: string;
  type: 'slider' | 'toggle' | 'gauge' | 'button' | 'status_led';
  value: string | number | boolean;
  color: string;
  binding: string; // The code parameter this widget binds to
}

export default function UiTranslatorInterpreter() {
  // Navigation tabs within this workspace
  const [activeSubTab, setActiveSubTab] = useState<'interpreter_canvas' | 'ui_customizer' | 'translator_trust'>('interpreter_canvas');

  // 1. INTERPRETER STATE: Code that gets interpreted into visual GUI controls
  const [rawInterpreterCode, setRawInterpreterCode] = useState<string>(
    `# AOSP Custom Board Control Map\n` +
    `# Background interpreter compiles these parameters into visual sliders/buttons\n\n` +
    `system.graphics.framerate = 90\n` +
    `hal.sensor.refresh_rate_ms = 16\n` +
    `device.display.brightness = 85\n` +
    `device.display.ambient_dimming = true\n` +
    `hardware.thermal.throttle_temp = 72\n` +
    `system.audio.surround_sound = true\n` +
    `boot.verify.signature_trust = true\n` +
    `developer.debug.terminal_port = 3000`
  );

  interface InterpretedParam {
    key: string;
    value: string | number | boolean;
    type: 'number' | 'boolean' | 'string';
    category: string;
  }

  const [interpretedParams, setInterpretedParams] = useState<InterpretedParam[]>([]);
  const [interpreterLogs, setInterpreterLogs] = useState<string[]>([]);
  const [isInterpreting, setIsInterpreting] = useState<boolean>(false);

  // 2. CUSTOM UI CUSTOMIZER: Mess with UIs and layout
  const [canvasBgColor, setCanvasBgColor] = useState<string>('from-[#0f172a] to-[#1e1e38]');
  const [layoutTheme, setLayoutTheme] = useState<'industrial' | 'neon' | 'monochrome'>('neon');
  const [uiWidgets, setUiWidgets] = useState<UiWidget[]>([
    { id: '1', label: 'ColorSensor HAL Sensitivity', type: 'slider', value: 75, color: '#6366f1', binding: 'hal.sensor.sensitivity' },
    { id: '2', label: 'Refresh Rate Force', type: 'toggle', value: true, color: '#10b981', binding: 'system.graphics.force_hertz' },
    { id: '3', label: 'Display Panel Lumens', type: 'gauge', value: 85, color: '#f59e0b', binding: 'device.display.brightness' },
    { id: '4', label: 'Trigger Fastboot Bootloader Mode', type: 'button', value: 'TRIGGER', color: '#ef4444', binding: 'boot.action.recovery' },
    { id: '5', label: 'Secure Root Seal Integrity', type: 'status_led', value: 'SECURE', color: '#10b981', binding: 'boot.verify.signature_trust' }
  ]);

  const [newWidgetLabel, setNewWidgetLabel] = useState<string>('Custom Audio Level');
  const [newWidgetType, setNewWidgetType] = useState<'slider' | 'toggle' | 'button'>('slider');
  const [newWidgetColor, setNewWidgetColor] = useState<string>('#6366f1');
  const [newWidgetBinding, setNewWidgetBinding] = useState<string>('system.audio.volume');

  // 3. TRANSLATOR & TRUST STATE
  const [targetLocale, setTargetLocale] = useState<string>('es_ES');
  const [localeLabel, setLocaleLabel] = useState<string>('Spanish (Castilian)');
  const [translations, setTranslations] = useState<LanguageString[]>([
    { id: '1', key: 'sys_boot_msg', en: 'Android is starting...', targetLang: 'Android se está iniciando...', category: 'system_ui' },
    { id: '2', key: 'hal_err_init', en: 'Sensor peripheral hardware initial connection failed.', targetLang: 'Fallo de conexión inicial del hardware del sensor.', category: 'hal_errors' },
    { id: '3', key: 'verify_secure_boot', en: 'Secure Boot signature validation successful.', targetLang: 'Validación de firma de Arranque Seguro exitosa.', category: 'bootloader' },
    { id: '4', key: 'recovery_warning_wipe', en: 'Warning: This action will wipe all flash blocks.', targetLang: 'Advertencia: Esta acción borrará todos los bloques de memoria flash.', category: 'recovery' }
  ]);

  const [newTransKey, setNewTransKey] = useState<string>('sys_wifi_connecting');
  const [newTransEn, setNewTransEn] = useState<string>('Connecting to wireless access point...');
  const [newTransTarget, setNewTransTarget] = useState<string>('Conectando al punto de acceso inalámbrico...');
  const [newTransCat, setNewTransCat] = useState<'system_ui' | 'hal_errors' | 'bootloader' | 'recovery'>('system_ui');

  const [trustCerts, setTrustCerts] = useState<TrustCertificate[]>([
    { id: '1', alias: 'AOSP-GSI-SuperKey', fingerprint: 'E9:C4:F3:12:0A:8B:D8:E3:4C:D8:1A:90', algorithm: 'RSA-4096', scope: 'super_partition', status: 'trusted' },
    { id: '2', alias: 'ColorSensor-HAL-AIDL-Sig', fingerprint: '22:A1:D9:E0:44:F3:89:33:AA:5B:44:CC', algorithm: 'Ed25519', scope: 'dm_verity', status: 'trusted' },
    { id: '3', alias: 'Recovery-AOSP-Payload', fingerprint: 'BC:8C:C9:DF:15:33:0A:E4:99:EE:11:7C', algorithm: 'ECDSA-P384', scope: 'ota_payload', status: 'trusted' }
  ]);

  const [newCertAlias, setNewCertAlias] = useState<string>('MyCustomFuserVerityKey');
  const [newCertScope, setNewCertScope] = useState<'super_partition' | 'dm_verity' | 'ota_payload'>('dm_verity');
  const [newCertAlgo, setNewCertAlgo] = useState<'RSA-4096' | 'ECDSA-P384' | 'Ed25519'>('Ed25519');

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Parse raw text code into live GUI components in real-time
  const interpretConfiguration = () => {
    setIsInterpreting(true);
    setInterpreterLogs(['[*] Initializing Background Config Interpreter...', '[*] Parsing configuration tokens...']);

    setTimeout(() => {
      const lines = rawInterpreterCode.split('\n');
      const parsed: InterpretedParam[] = [];

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const parts = trimmed.split('=');
        if (parts.length === 2) {
          const key = parts[0].trim();
          let rawVal = parts[1].trim();

          let value: string | number | boolean = rawVal;
          let type: 'number' | 'boolean' | 'string' = 'string';

          if (rawVal === 'true' || rawVal === 'false') {
            value = rawVal === 'true';
            type = 'boolean';
          } else if (!isNaN(Number(rawVal))) {
            value = Number(rawVal);
            type = 'number';
          }

          // Guess category from key prefixes
          let category = 'System';
          if (key.startsWith('hal.')) category = 'HAL Services';
          else if (key.startsWith('device.')) category = 'Display Panels';
          else if (key.startsWith('boot.')) category = 'Bootloader Config';
          else if (key.startsWith('developer.')) category = 'Debug Protocols';

          parsed.push({ key, value, type, category });
        }
      });

      setInterpretedParams(parsed);
      setInterpreterLogs((prev) => [
        ...prev,
        `[SUCCESS] Correctly interpreted ${parsed.length} parameters.`,
        `[Interpreter] Bound dynamic controls to memory buffer. Sync active!`
      ]);
      setIsInterpreting(false);
    }, 1200);
  };

  // Run interpreter immediately on load and when code resets
  useEffect(() => {
    interpretConfiguration();
  }, []);

  // Sync state change back to raw code (when GUI updates parameter, background code changes!)
  const handleGuiControlChange = (key: string, newValue: string | number | boolean) => {
    // Update interpreted parameters list
    setInterpretedParams((prev) =>
      prev.map((p) => (p.key === key ? { ...p, value: newValue } : p))
    );

    // Reconstruct the raw code block in background!
    const lines = rawInterpreterCode.split('\n');
    const updatedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      const parts = trimmed.split('=');
      if (parts.length === 2 && parts[0].trim() === key) {
        return `${key} = ${newValue}`;
      }
      return line;
    });

    setRawInterpreterCode(updatedLines.join('\n'));
    logInterpreterEvent(`[Sync] GUI tweak: '${key}' mutated to '${newValue}' -> Updated background script.`);
  };

  const logInterpreterEvent = (msg: string) => {
    setInterpreterLogs((prev) => [...prev, msg]);
  };

  // Add custom UI widget (Messi with UI)
  const handleAddWidget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWidgetLabel.trim()) return;

    const widget: UiWidget = {
      id: `widget-${Date.now()}`,
      label: newWidgetLabel.trim(),
      type: newWidgetType,
      value: newWidgetType === 'slider' ? 50 : newWidgetType === 'toggle' ? false : 'TRIGGER',
      color: newWidgetColor,
      binding: newWidgetBinding.trim() || 'custom.config.param'
    };

    setUiWidgets((prev) => [...prev, widget]);
    setNewWidgetLabel('');
    setNewWidgetBinding('');
  };

  // Delete/Remove visual widget
  const handleRemoveWidget = (id: string) => {
    setUiWidgets((prev) => prev.filter((w) => w.id !== id));
  };

  // Modify specific widgets values in visual designer preview
  const handleWidgetInteraction = (id: string, newVal: any) => {
    setUiWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, value: newVal } : w))
    );
    const widget = uiWidgets.find((w) => w.id === id);
    if (widget) {
      logInterpreterEvent(`[UI Customizer] Widget Action: '${widget.label}' (${widget.binding}) set to '${newVal}'`);
    }
  };

  // Add translation entry
  const handleAddTranslation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTransKey.trim()) return;

    const trans: LanguageString = {
      id: `trans-${Date.now()}`,
      key: newTransKey.trim(),
      en: newTransEn,
      targetLang: newTransTarget,
      category: newTransCat
    };

    setTranslations((prev) => [...prev, trans]);
    setNewTransKey('');
    setNewTransEn('');
    setNewTransTarget('');
  };

  // Add Certificate Key (Trust Engine)
  const handleAddCert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCertAlias.trim()) return;

    const cert: TrustCertificate = {
      id: `cert-${Date.now()}`,
      alias: newCertAlias.trim(),
      fingerprint: Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0')
      ).join(':'),
      algorithm: newCertAlgo,
      scope: newCertScope,
      status: 'trusted'
    };

    setTrustCerts((prev) => [...prev, cert]);
    setNewCertAlias('');
  };

  const copyCodeToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback('Copied!');
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  // Generate compiled overlay/UI output configuration
  const compiledUiOverlayCode = `// Compiled Android UI Overlay Configuration\n` +
    `// Automatically generated based on Graphical Theme settings: "${layoutTheme}"\n\n` +
    `{ "canvas": {\n` +
    `  "theme": "${layoutTheme}",\n` +
    `  "background_gradient": "${canvasBgColor}",\n` +
    `  "widgets": [\n` +
    uiWidgets.map(w => `    { "id": "${w.id}", "label": "${w.label}", "type": "${w.type}", "binding": "${w.binding}", "color": "${w.color}" }`).join(',\n') +
    `\n  ]\n}}`;

  return (
    <div className="flex flex-col gap-8" id="ui-translator-interpreter-workspace">
      
      {/* HEADER BLOCK */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Languages className="w-48 h-48 text-indigo-500" />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold font-mono rounded-full flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 animate-spin" /> Live UI & Interpreter Studio
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <Languages className="text-indigo-500 w-7 h-7" /> Interpreter, Custom UI & Translator Studio
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Tweak embedded system layouts visually in front. Let the background configuration interpreter turn manual scripts into live graphics dynamically. Manage system locales and secure boot-signing trust structures.
            </p>
          </div>

          {/* Tab buttons */}
          <div className="flex bg-[#0a0d18] border border-[#1e293b] p-1 rounded-xl">
            <button
              onClick={() => setActiveSubTab('interpreter_canvas')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === 'interpreter_canvas'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" /> Background Interpreter
            </button>

            <button
              onClick={() => setActiveSubTab('ui_customizer')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === 'ui_customizer'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tv className="w-3.5 h-3.5" /> Mess with UIs
            </button>

            <button
              onClick={() => setActiveSubTab('translator_trust')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSubTab === 'translator_trust'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Languages className="w-3.5 h-3.5" /> Translators & Trust
            </button>
          </div>
        </div>
      </div>

      {/* SUB TAB 1: CODE INTERPRETER & GRAPHICAL SYNC (Coding in Background, GUI in Front) */}
      {activeSubTab === 'interpreter_canvas' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* LEFT PANEL: INTERPRETER GUI CONTROLLER (GUI shows in the Front) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">1</span>
                  Interpreted System Controller (GUI in Front)
                </h3>
                <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded font-mono font-bold">
                  LIVE INTERPRETED
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-normal mb-5">
                The controls below were generated dynamically in the front-end by parsing the plain-text script in the background. **Move the sliders** or **toggle switches** to watch the background code update in real-time.
              </p>

              {/* Dynamic interpreted sliders */}
              <div className="space-y-4">
                {interpretedParams.map((param) => (
                  <div key={param.key} className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="max-w-[280px]">
                      <span className="text-[10px] text-indigo-400 uppercase font-mono tracking-wider font-bold block">{param.category}</span>
                      <span className="text-xs font-bold font-mono text-white mt-1 block">{param.key}</span>
                    </div>

                    <div className="flex-1 max-w-sm flex items-center gap-4">
                      {param.type === 'number' && (
                        <div className="w-full flex items-center gap-3">
                          <input
                            type="range"
                            min="0"
                            max={param.key.includes('framerate') ? '144' : '100'}
                            value={Number(param.value)}
                            onChange={(e) => handleGuiControlChange(param.key, Number(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                          <span className="text-xs text-slate-300 font-mono w-10 text-right">{param.value}</span>
                        </div>
                      )}

                      {param.type === 'boolean' && (
                        <div className="w-full flex justify-end">
                          <div 
                            onClick={() => handleGuiControlChange(param.key, !param.value)}
                            className={`w-10 h-5 rounded-full transition-colors cursor-pointer p-0.5 ${param.value ? 'bg-indigo-500' : 'bg-slate-700'}`}
                          >
                            <div className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${param.value ? 'translate-x-5' : ''}`} />
                          </div>
                        </div>
                      )}

                      {param.type === 'string' && (
                        <input
                          type="text"
                          value={String(param.value)}
                          onChange={(e) => handleGuiControlChange(param.key, e.target.value)}
                          className="w-full bg-[#0a0d18] border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-300 font-mono focus:outline-none"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick terminal output log for interpreter operations */}
            <div className="mt-5 pt-4 border-t border-slate-900 font-mono text-[9.5px] text-slate-500">
              <span className="uppercase block font-bold mb-1">Interpreter Events Trace Log</span>
              <div className="bg-slate-950/80 p-2.5 rounded border border-slate-900 text-slate-400 h-[65px] overflow-y-auto space-y-0.5">
                {interpreterLogs.map((log, i) => (
                  <div key={i} className="truncate"><span className="text-indigo-400">#</span> {log}</div>
                ))}
              </div>
            </div>

          </div>

          {/* RIGHT PANEL: RAW INTERPRETED CODE (Coding in the background) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-1 flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <Code className="w-4 h-4 text-indigo-400" /> Coding Input (Background)
                  </h3>
                  <button
                    onClick={interpretConfiguration}
                    disabled={isInterpreting}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[10px] rounded flex items-center gap-1.5 cursor-pointer"
                  >
                    {isInterpreting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Interpret Code
                  </button>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  This raw plain text is parsed dynamically by our configuration engine. Edit the values in the code box below directly and click **Interpret Code** to compile them into the front-end UI.
                </p>
              </div>

              <textarea
                value={rawInterpreterCode}
                onChange={(e) => setRawInterpreterCode(e.target.value)}
                className="w-full flex-1 bg-[#050811] text-indigo-300 font-mono text-[10.5px] leading-relaxed resize-none focus:outline-none p-3.5 rounded-xl border border-slate-900 h-[320px]"
                style={{ tabSize: 4 }}
              />

              <div className="mt-4 p-4 bg-indigo-950/10 border border-indigo-500/10 rounded-xl space-y-2">
                <span className="text-[10px] font-bold font-mono text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-indigo-400" /> How Background Compilers Work
                </span>
                <p className="text-[10.5px] text-slate-400 leading-normal">
                  Our embedded background interpreter validates parameter blocks, establishes standard bounds limits (such as capping brightness at 100), and maintains bidirectional mapping logic. This mimics the actual AOSP device configurations overlays (`config.xml`) compiling pipelines.
                </p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* SUB TAB 2: MESS WITH UIs (Visual Device Designer Canvas) */}
      {activeSubTab === 'ui_customizer' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* LEFT PANEL: VISUAL DEVICE SIMULATOR CANVAS (GUI shows in Front) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[10px]">1</span>
                  Device Control Panel Canvas (GUI in Front)
                </h3>
                <span className="text-[10px] font-mono text-slate-500">Active layout theme: {layoutTheme.toUpperCase()}</span>
              </div>

              {/* Graphical Customization options bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 p-4 bg-slate-950 rounded-xl border border-slate-900">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Canvas Aesthetic Theme</label>
                  <div className="flex gap-2">
                    {['neon', 'industrial', 'monochrome'].map((theme) => (
                      <button
                        key={theme}
                        onClick={() => {
                          setLayoutTheme(theme as any);
                          if (theme === 'neon') setCanvasBgColor('from-[#0a0f1d] to-[#121c33]');
                          else if (theme === 'industrial') setCanvasBgColor('from-[#1c1917] to-[#292524]');
                          else setCanvasBgColor('from-[#0f172a] to-[#1e293b]');
                        }}
                        className={`flex-1 p-2 border rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                          layoutTheme === theme
                            ? 'bg-indigo-500/10 border-indigo-500 text-white font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        {theme.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Interactive Layout Color</label>
                  <div className="flex gap-2 items-center h-[36px]">
                    {[
                      { hex: '#6366f1', label: 'Indigo' },
                      { hex: '#10b981', label: 'Emerald' },
                      { hex: '#f59e0b', label: 'Amber' },
                      { hex: '#ef4444', label: 'Rose' },
                      { hex: '#06b6d4', label: 'Cyan' }
                    ].map((col) => (
                      <button
                        key={col.hex}
                        onClick={() => setNewWidgetColor(col.hex)}
                        className="w-6 h-6 rounded-full cursor-pointer transition-transform border border-slate-800 hover:scale-110 shrink-0"
                        style={{ backgroundColor: col.hex }}
                        title={col.label}
                      />
                    ))}
                    <span className="text-xs text-slate-400 font-mono pl-2">{newWidgetColor}</span>
                  </div>
                </div>
              </div>

              {/* LIVE DEVICE IFRAME DESIGN CANVAS CARD */}
              <div className={`p-6 bg-gradient-to-br ${canvasBgColor} rounded-2xl border border-slate-800/80 min-h-[300px] flex flex-col justify-between shadow-2xl relative overflow-hidden`}>
                
                {/* Visual grid overlay to represent industrial hardware UI */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />

                {/* Device Header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4 relative z-10">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-[10px] font-mono tracking-widest text-slate-300 font-bold uppercase">AOSP CORE RUNTIME PREVIEW</span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 bg-black/40 px-2 py-0.5 rounded border border-white/5">DEVICE PANEL</span>
                </div>

                {/* Live widgets render grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10 mb-6">
                  {uiWidgets.map((w) => (
                    <div 
                      key={w.id} 
                      className={`p-4 rounded-xl border transition-all ${
                        layoutTheme === 'neon' 
                          ? 'bg-black/60 border-white/5 shadow-inner' 
                          : layoutTheme === 'industrial' 
                            ? 'bg-stone-900/80 border-stone-800' 
                            : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2.5">
                        <span className="text-[11px] font-bold text-slate-300 leading-tight">{w.label}</span>
                        <button
                          onClick={() => handleRemoveWidget(w.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                          title="Remove custom widget"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Render slider widget */}
                      {w.type === 'slider' && (
                        <div className="space-y-1.5">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={Number(w.value)}
                            onChange={(e) => handleWidgetInteraction(w.id, Number(e.target.value))}
                            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                            style={{ accentColor: w.color, backgroundColor: 'rgba(255,255,255,0.1)' }}
                          />
                          <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                            <span>Bind: {w.binding}</span>
                            <span style={{ color: w.color }} className="font-bold">{w.value}%</span>
                          </div>
                        </div>
                      )}

                      {/* Render toggle widget */}
                      {w.type === 'toggle' && (
                        <div className="flex items-center justify-between">
                          <span className="text-[9.5px] text-slate-400 font-mono">Bind: {w.binding}</span>
                          <div 
                            onClick={() => handleWidgetInteraction(w.id, !w.value)}
                            className="w-9 h-5 rounded-full transition-colors cursor-pointer p-0.5"
                            style={{ backgroundColor: w.value ? w.color : '#475569' }}
                          >
                            <div className={`w-4 h-4 rounded-full bg-black transition-transform ${w.value ? 'translate-x-4' : ''}`} />
                          </div>
                        </div>
                      )}

                      {/* Render button trigger */}
                      {w.type === 'button' && (
                        <button
                          onClick={() => {
                            alert(`Fired platform trigger: ${w.binding}`);
                            logInterpreterEvent(`[UI Customizer] Executed trigger binding: ${w.binding}`);
                          }}
                          className="w-full py-1.5 rounded text-xs font-bold text-black transition-all hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
                          style={{ backgroundColor: w.color }}
                        >
                          <MousePointerClick className="w-3.5 h-3.5" /> Execute Action
                        </button>
                      )}

                      {/* Render Status Gauge */}
                      {w.type === 'gauge' && (
                        <div className="space-y-1.5">
                          <div className="w-full bg-white/5 h-2 rounded overflow-hidden p-0.5 border border-white/5">
                            <div className="h-full rounded" style={{ width: `${w.value}%`, backgroundColor: w.color }} />
                          </div>
                          <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                            <span>Bind: {w.binding}</span>
                            <span style={{ color: w.color }} className="font-bold">{w.value} LUX</span>
                          </div>
                        </div>
                      )}

                      {/* Render Status LED */}
                      {w.type === 'status_led' && (
                        <div className="flex items-center justify-between">
                          <span className="text-[9.5px] text-slate-400 font-mono">Bind: {w.binding}</span>
                          <span className="px-2 py-0.5 text-[9px] font-bold font-mono rounded flex items-center gap-1 bg-black/40 border border-white/5" style={{ color: w.color }}>
                            <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: w.color }} /> {String(w.value)}
                          </span>
                        </div>
                      )}

                    </div>
                  ))}
                </div>

                {/* Device Footer */}
                <div className="flex items-center justify-between text-[9.5px] font-mono text-slate-400 border-t border-white/5 pt-3 mt-auto relative z-10">
                  <span>Theme: {layoutTheme.toUpperCase()} Layout</span>
                  <span>Grid Sizer: Fluid bento layout</span>
                </div>

              </div>

            </div>
          </div>

          {/* RIGHT PANEL: COMPILED LAYOUT CONFIG (Background Coding) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div className="flex-1 flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                    <Palette className="w-4 h-4 text-indigo-400" /> Compiled UI Layout (Background)
                  </h3>
                  
                  <button
                    onClick={() => copyCodeToClipboard(compiledUiOverlayCode)}
                    className="px-2 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white rounded text-[10px] font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" /> {copyFeedback || 'Copy Config'}
                  </button>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  As you drag, edit, or color widgets in the visual editor in the front, the compiler dynamically updates the background JSON layout config.
                </p>

                {/* Widget Builder Form */}
                <div className="p-4 bg-[#0a0d18] rounded-xl border border-slate-900/60 mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-2.5">Bootstrap New UI Control</span>
                  
                  <form onSubmit={handleAddWidget} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Control Label</label>
                        <input
                          type="text"
                          required
                          value={newWidgetLabel}
                          onChange={(e) => setNewWidgetLabel(e.target.value)}
                          placeholder="e.g. Master Volume"
                          className="w-full bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Control Format</label>
                        <select
                          value={newWidgetType}
                          onChange={(e) => setNewWidgetType(e.target.value as any)}
                          className="w-full bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="slider">Interactive Slider</option>
                          <option value="toggle">On/Off Switch Toggle</option>
                          <option value="button">Action Click Button</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">System Memory Mapping / Binding parameter</label>
                      <input
                        type="text"
                        required
                        value={newWidgetBinding}
                        onChange={(e) => setNewWidgetBinding(e.target.value)}
                        placeholder="e.g. system.audio.volume_level"
                        className="w-full bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none font-mono"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full flex items-center justify-center gap-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 rounded py-2 text-xs font-bold cursor-pointer"
                    >
                      <Plus className="w-4 h-4" /> Inject Widget Control to Canvas
                    </button>
                  </form>
                </div>
              </div>

              {/* Layout Config text box */}
              <textarea
                readOnly
                value={compiledUiOverlayCode}
                className="w-full bg-[#050811] text-emerald-400 font-mono text-[10.5px] leading-relaxed resize-none focus:outline-none p-3.5 rounded-xl border border-slate-900 h-[220px]"
                style={{ tabSize: 2 }}
              />
            </div>
          </div>

        </div>
      )}

      {/* SUB TAB 3: TRANSLATOR & CRYPTOGRAPHIC TRUST MANAGER */}
      {activeSubTab === 'translator_trust' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT COLUMN: MULTILINGUAL TRANSLATION INTERACTIVE MANAGER (GUI in Front) */}
          <div className="lg:col-span-7 bg-[#111827] border border-[#1e293b] rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Languages className="w-4.5 h-4.5 text-indigo-400" /> AOSP System Multilingual Translators (GUI in Front)
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[9.5px] font-mono text-slate-500">Active Locale:</span>
                <input
                  type="text"
                  value={targetLocale}
                  onChange={(e) => setTargetLocale(e.target.value)}
                  className="bg-slate-950 border border-slate-900 rounded px-2 py-0.5 text-[10px] font-mono font-bold text-indigo-300 text-center w-16"
                  title="locale string code"
                />
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-normal mb-5">
              Input localized translator key strings. Our dynamic localization compiler translates standard Android framework messages, fast-boot recovery warning messages, and driver errors.
            </p>

            {/* Translation grid */}
            <div className="space-y-3">
              {translations.map((t) => (
                <div key={t.id} className="p-4 bg-slate-950 rounded-xl border border-slate-900 hover:border-slate-850 transition-all space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-900/60 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.2 rounded font-bold uppercase">
                        {t.category}
                      </span>
                      <span className="font-mono text-xs font-bold text-white">{t.key}</span>
                    </div>

                    <button
                      onClick={() => setTranslations(prev => prev.filter(item => item.id !== t.id))}
                      className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                      title="Remove key translation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-medium leading-normal">
                    <div className="p-2 bg-[#090b14] rounded border border-slate-900/80">
                      <span className="text-[9px] font-mono text-slate-500 uppercase font-bold block mb-1">English Baseline</span>
                      <span className="text-slate-300">{t.en}</span>
                    </div>

                    <div className="p-2 bg-indigo-950/10 rounded border border-indigo-500/10">
                      <span className="text-[9px] font-mono text-indigo-400 uppercase font-bold block mb-1">Target Language Translation ({targetLocale.toUpperCase()})</span>
                      <input
                        type="text"
                        value={t.targetLang}
                        onChange={(e) => {
                          const updatedVal = e.target.value;
                          setTranslations(prev => prev.map(item => item.id === t.id ? { ...item, targetLang: updatedVal } : item));
                        }}
                        className="w-full bg-slate-950 border border-slate-900/80 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Translation string bootstrap adder */}
            <div className="mt-6 pt-5 border-t border-slate-900">
              <span className="text-xs font-bold text-white uppercase block mb-3 font-mono">Register New Translator Strings Key</span>
              
              <form onSubmit={handleAddTranslation} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Unique Key Identifier</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. boot_securing_status"
                    value={newTransKey}
                    onChange={(e) => setNewTransKey(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Framework Category</label>
                  <select
                    value={newTransCat}
                    onChange={(e) => setNewTransCat(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none font-mono"
                  >
                    <option value="system_ui">System UI Strings</option>
                    <option value="hal_errors">HAL Drivers Errors</option>
                    <option value="bootloader">Bootloader Logs</option>
                    <option value="recovery">Recovery Modes warnings</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">English Base Content</label>
                  <input
                    type="text"
                    required
                    placeholder="Type default English notification message..."
                    value={newTransEn}
                    onChange={(e) => setNewTransEn(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Target Translated Message</label>
                  <input
                    type="text"
                    required
                    placeholder="Type translation value..."
                    value={newTransTarget}
                    onChange={(e) => setNewTransTarget(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2 pt-1.5">
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 rounded-lg py-2.5 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Append Localization Key to System XML
                  </button>
                </div>
              </form>
            </div>

          </div>

          {/* RIGHT COLUMN: SECURITY TRUST KEYS AND OTA CODE-SIGNING (Background Coding) */}
          <div className="lg:col-span-5 bg-slate-950 border border-[#1e293b] rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" /> Platform Security Keys (Trust Engine)
                </h3>
                <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-mono font-bold">
                  ENCRYPTED
                </span>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                Verify cryptographical signatures and authorize secure boot payload handshakes inside our custom partition partitions layout:
              </p>

              {/* Certificates listing */}
              <div className="space-y-3 mb-5">
                {trustCerts.map((c) => (
                  <div key={c.id} className="p-3 bg-[#070a14] rounded-xl border border-slate-900 text-xs font-mono">
                    <div className="flex justify-between items-center mb-1 border-b border-slate-950 pb-1">
                      <span className="font-bold text-indigo-300 flex items-center gap-1 text-[11px]">
                        <Key className="w-3.5 h-3.5 text-indigo-400" /> {c.alias}
                      </span>
                      <span className="text-[8.5px] bg-slate-950 text-slate-400 px-1.5 py-0.2 rounded font-bold uppercase">{c.algorithm}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-y-0.5 text-[10px] text-slate-400 mt-1.5">
                      <span>Authority Scope:</span><span className="text-white font-semibold uppercase text-right">{c.scope.replace('_', ' ')}</span>
                      <span>Signature Integrity:</span><span className="text-emerald-400 font-semibold text-right uppercase">{c.status}</span>
                    </div>

                    <div className="mt-2 text-[9px] text-slate-500 bg-slate-950 p-1.5 rounded select-all break-all border border-slate-900/40">
                      SHA256: {c.fingerprint}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Certificate Key form */}
              <div className="p-4 bg-[#0a0d18] rounded-xl border border-slate-900/60">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono block mb-2.5">Generate Cryptographic Boot Key</span>

                <form onSubmit={handleAddCert} className="space-y-3">
                  <div>
                    <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Key Alias / Handle</label>
                    <input
                      type="text"
                      required
                      value={newCertAlias}
                      onChange={(e) => setNewCertAlias(e.target.value)}
                      placeholder="e.g. MyOEM-SignatureKey"
                      className="w-full bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Key Target Scope</label>
                      <select
                        value={newCertScope}
                        onChange={(e) => setNewCertScope(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value="super_partition">Super Volume</option>
                        <option value="dm_verity">DM-Verity Integrity</option>
                        <option value="ota_payload">OTA Payload Update</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Crypto Standard</label>
                      <select
                        value={newCertAlgo}
                        onChange={(e) => setNewCertAlgo(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none font-mono"
                      >
                        <option value="Ed25519">Ed25519 (Fastest)</option>
                        <option value="ECDSA-P384">ECDSA P-384</option>
                        <option value="RSA-4096">RSA 4096-bit</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 rounded py-2 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Sign & Register Public Trust Key
                  </button>
                </form>
              </div>

            </div>
          </div>

        </div>
      )}

    </div>
  );
}
