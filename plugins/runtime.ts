/**
 * Plugin runtime.
 *
 * An addon is a directory under `plugins/` with a `plugin.json` and one
 * `server.mjs` module. The server imports it at boot, hands it a narrow context,
 * and mounts whatever routes and UI panels it declares. Nothing in the core app
 * imports a plugin by name, so an addon can be deleted and the builder still
 * starts.
 *
 * Why a real directory scan instead of a hardcoded list: the point of an addon
 * pack is that it is droppable. If adding a lab meant editing `server.ts`, it
 * would be a core feature wearing a plugin costume.
 *
 * The contract is deliberately small: routes are plain express handlers, and a
 * panel is a descriptor the UI renders in its own tab. A plugin never touches
 * the DOM or the core state directly; it talks over HTTP like any other client.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { Express, RequestHandler } from "express";

export interface PluginPanel {
  /** Stable id; the UI uses it for the tab key. */
  id: string;
  title: string;
  /** One line under the title. */
  subtitle: string;
  /** lucide-react icon name the UI knows how to render. */
  icon?: string;
  /** Where the UI fetches this panel's data. */
  endpoint?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** What the plugin needs installed to do real work, stated as tools. */
  requires: string[];
  panels: PluginPanel[];
  /** Optional: the plugin also wants a sidebar entry under this group. */
  category?: string;
  /**
   * How the host should render this plugin.
   *
   *   "panel"    a dedicated component chosen by id (the built-in labs)
   *   "pipeline" ordered stages described as data, rendered generically
   *
   * A pipeline plugin needs no host change: it returns its stages from
   * /pipeline and the generic renderer draws them. That is what makes a new
   * build pipeline a drop-in directory rather than an edit to PluginHost.
   */
  kind?: "panel" | "pipeline";
}

export interface PluginContext {
  /** Mount under `/api/plugins/<id>`. */
  route: (subpath: string, handler: RequestHandler) => void;
  /** This plugin's own manifest, so it can report its `requires` list. */
  manifest: PluginManifest;
  /** Absolute directory of the plugin, for data files. */
  dir: string;
  /** A place to keep workspace under `data/plugins/<id>`. */
  workDir: () => string;
  log: (msg: string) => void;
  /** Tool lookup shared with the core format registry. */
  which: (tool: string) => string | null;
  /**
   * Attach a WebSocket handler under `/api/plugins/<id>/<subpath>`.
   *
   * A terminal needs a stream: polling a PTY over HTTP drops keystrokes and
   * cannot carry escape sequences. The global WebSocket server dispatches by
   * path, so a plugin claims its own prefix and the rest of the app is
   * unaffected.
   */
  wsRoute: (subpath: string, handler: (ws: any, req: any) => void) => void;
}

/** Path prefix -> handler, for plugins that need a socket. */
const wsRoutes: Array<{ path: string; handler: (ws: any, req: any) => void }> = [];

/**
 * Give an incoming socket to a plugin, if its path matches.
 *
 * Returns true when claimed, so the core handler can skip its own dispatch
 * rather than two handlers writing to one socket.
 */
export function dispatchPluginWs(ws: any, req: any): boolean {
  const url = String(req?.url ?? "").split("?")[0];
  // Longest prefix wins, so /ws/term beats /ws if both exist.
  const match = wsRoutes
    .filter((r) => url === r.path || url.startsWith(r.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!match) return false;
  try {
    match.handler(ws, req);
    return true;
  } catch (e) {
    console.error(`[plugins] ws handler for ${match.path} threw:`, e);
    try { ws.close(); } catch { /* already gone */ }
    return true;
  }
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** False when the module failed to import; the manifest still shows, degraded. */
  healthy: boolean;
  error?: string;
  /** Tools the manifest wants that are missing right now. */
  missing: string[];
  /** Code the UI can copy into a workflow, if the plugin supplies one. */
  workflowSnippet?: (body: any) => string;
  /** Extra endpoints the UI may drive, exposed as metadata only. */
  exports?: Record<string, string>;
}

export interface PluginModule {
  /** Called once at mount time. Register routes here. */
  register: (ctx: PluginContext) => void | Promise<void>;
  /**
   * Optional: produce a GitHub Actions step block for this plugin's work, so a
   * build composed in the GUI can carry the plugin into the pipeline.
   */
  workflowSnippet?: (body: any) => string;
  /** Optional: named endpoints, so the UI can show what the plugin offers. */
  exports?: Record<string, string>;
}

const loaded: LoadedPlugin[] = [];

function which(tool: string): string | null {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const d of dirs) {
    const p = `${d}/${tool}`;
    try {
      const st = fs.statSync(p);
      if (st.isFile() && (st.mode & 0o111) !== 0) return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function readManifest(dir: string): PluginManifest | null {
  const file = path.join(dir, "plugin.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch (e: any) {
    console.error(`[plugins] ${dir}: plugin.json is not valid JSON: ${e.message}`);
    return null;
  }
  if (!m?.id || !m?.name) {
    console.error(`[plugins] ${dir}: plugin.json needs at least "id" and "name"`);
    return null;
  }
  return {
    id: String(m.id),
    name: String(m.name),
    version: String(m.version ?? "0.0.0"),
    description: String(m.description ?? ""),
    requires: Array.isArray(m.requires) ? m.requires.map(String) : [],
    category: m.category ? String(m.category) : undefined,
    // Unknown kinds fall back to "panel" rather than breaking the dispatch.
    kind: m.kind === "pipeline" ? "pipeline" : "panel",
    panels: Array.isArray(m.panels)
      ? m.panels
          .filter((p: any) => p?.id && p?.title)
          .map((p: any) => ({
            id: String(p.id),
            title: String(p.title),
            subtitle: String(p.subtitle ?? ""),
            icon: p.icon ? String(p.icon) : undefined,
            endpoint: p.endpoint ? String(p.endpoint) : undefined,
          }))
      : [],
  };
}

/**
 * Load every plugin directory under `root`, mounting its routes on `app`.
 *
 * A plugin that throws during import is recorded as unhealthy and skipped: one
 * broken addon must not stop the builder from starting.
 */
export async function loadPlugins(app: Express, root: string): Promise<LoadedPlugin[]> {
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }

  for (const name of entries) {
    const dir = path.join(root, name);
    const manifest = readManifest(dir);
    if (!manifest) continue;

    const missing = manifest.requires.filter((t) => !which(t));
    const record: LoadedPlugin = { manifest, healthy: false, missing };
    loaded.push(record);

    const entryFile = ["server.mjs", "server.js", "index.mjs"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!entryFile) {
      record.error = "no server.mjs — manifest is visible but the plugin has no backend";
      console.warn(`[plugins] ${manifest.id}: no server.mjs`);
      continue;
    }

    try {
      const mod = (await import(pathToFileURL(entryFile).href)) as PluginModule;
      if (typeof mod.register !== "function") {
        record.error = "server.mjs does not export register(ctx)";
        continue;
      }
      const base = `/api/plugins/${manifest.id}`;
      const ctx: PluginContext = {
        manifest,
        route: (subpath, handler) => {
          const p = subpath === "/" ? base : `${base}${subpath.startsWith("/") ? subpath : `/${subpath}`}`;
          app.all(p, handler);
        },
        dir,
        workDir: () => {
          const w = path.join(process.cwd(), "data", "plugins", manifest.id);
          fs.mkdirSync(w, { recursive: true });
          return w;
        },
        log: (msg: string) => console.log(`[plugins:${manifest.id}] ${msg}`),
        which,
        wsRoute: (subpath, handler) => {
          const p = subpath === "/" ? base : `${base}${subpath.startsWith("/") ? subpath : `/${subpath}`}`;
          wsRoutes.push({ path: p, handler });
        },
      };
      await mod.register(ctx);
      record.healthy = true;
      if (typeof mod.workflowSnippet === "function") record.workflowSnippet = mod.workflowSnippet;
      if (mod.exports) record.exports = mod.exports;
      console.log(
        `[plugins] ${manifest.id} ${manifest.version} mounted at ${base}` +
          (missing.length ? ` — MISSING TOOLS: ${missing.join(", ")}` : ""),
      );
    } catch (e: any) {
      record.error = String(e?.stack ?? e?.message ?? e);
      console.error(`[plugins] ${manifest.id} failed to load: ${record.error}`);
    }
  }

  return loaded;
}

/** Manifest-only view for the UI, with no handler references. */
export function pluginSummaries() {
  return loaded.map((p) => ({
    ...p.manifest,
    healthy: p.healthy,
    error: p.error,
    missing: p.missing,
    endpointBase: `/api/plugins/${p.manifest.id}`,
    exports: p.exports ?? null,
  }));
}

/** The workflow snippet for a plugin, if it has one. */
export function pluginSnippet(id: string, body: any): string | null {
  const p = loaded.find((x) => x.manifest.id === id);
  if (!p?.workflowSnippet) return null;
  try {
    return p.workflowSnippet(body);
  } catch (e: any) {
    return `# plugin ${id} could not render a workflow step: ${e.message}`;
  }
}
