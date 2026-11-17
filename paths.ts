/**
 * Where the app's data files live.
 *
 * In development the server is started from the project root, so `process.cwd()`
 * points at the catalogs. That assumption breaks the moment the app is packaged:
 * a launcher can start the binary from any directory, and an AppImage runs from a
 * temporary mount with its own idea of the working directory.
 *
 * So every data file is resolved through `dataFile()`, which tries, in order:
 *
 *   1. ANYREALM_DATA_DIR, when a deployment wants to override everything
 *   2. the directory holding the running server file (packaged layouts)
 *   3. the working directory (development)
 *
 * and for the packaged case, one level up as well, because the launcher lives in
 * `resources/app/` while the JSON files sit beside it.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** The directory this module was loaded from, with a fallback for bundled builds. */
function here(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // Bundled to CJS by esbuild: __dirname exists there.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (globalThis as any).__dirname === "string"
      ? (globalThis as any).__dirname
      : process.cwd();
  }
}

/** Every candidate directory, in the order they should be tried. */
export function dataDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.ANYREALM_DATA_DIR) dirs.push(process.env.ANYREALM_DATA_DIR);
  const h = here();
  dirs.push(h, path.dirname(h), process.cwd());
  // Deduplicate while keeping order, so a repeated path is not tried twice.
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

/**
 * Resolve a data file. Returns the first existing candidate, or the primary
 * candidate when none exists so the caller's own error message names a real path.
 */
export function dataFile(name: string): string {
  for (const d of dataDirs()) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dataDirs()[0] ?? process.cwd(), name);
}

/**
 * Directories a request is allowed to read or write. Packaged installs have no
 * workspace, so the app's own data directory and the user's temp are the only
 * places that make sense.
 */
export function allowedRoots(): string[] {
  const roots = [...dataDirs(), "/tmp", "/var/tmp"];
  const home = process.env.HOME;
  if (home) roots.push(path.join(home, ".anyrealm"));
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

/** True when `abs` is inside one of the allowed roots. */
export function insideAllowed(abs: string): boolean {
  const a = path.resolve(abs);
  return allowedRoots().some((r) => a === r || a.startsWith(r + path.sep));
}
