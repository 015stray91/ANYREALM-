/**
 * The UX array: builder slots, one choice each, in the same shape as the rootfs
 * and kernel pickers.
 *
 * The catalog in ux-catalog.ts answers "what is this tree". This module turns it
 * into what a picker actually renders: a small set of slots, each with a list of
 * options, where the user picks exactly one per slot. Nothing here composes a
 * whole plan from a multi-select -- the builder has one display owner, one shell,
 * one theme source and one package source, and each of those is a single value.
 *
 * The mechanism that makes "fused, not layered" true is SurfaceFlinger itself.
 * It does not own the panel: it delegates presentation through `DisplaySurface`
 * (`beginFrame`, `prepareFrame(CompositionType)`, `advanceFrame`,
 * `onFrameCommitted`), and `CompositionType` already distinguishes `Gpu`, `Hwc`
 * and `Mixed`. So the display owner is a `DisplaySurface` implementation, a shell
 * is a surface source into that same scene, and a theme is data the owner loads.
 * One scene, one atomic commit -- no frame hand-off between halves.
 */

import fs from "fs";
import {
  UX_CATALOG,
  describeUxChoices,
  type UxEntry,
  type UxMechanism,
} from "./ux-catalog";

export type Edition = "rom" | "desktop_iso" | "mobile_kernel";

/** How a piece attaches to the single fused display. */
export type IntegrationKind =
  /** Owns DRM / the panel; is the DisplaySurface. */
  | "display_owner"
  /** A client of an owner; supplies surfaces into the owner's scene. */
  | "wayland_client"
  /** Tokens/components only; no surfaces of its own. */
  | "theme"
  /** Packages a rootfs installs; no code links into the display. */
  | "package_source"
  /** Cannot be integrated; carry the reason so the UI can say it plainly. */
  | "refuse";

/** The seam in SurfaceFlinger / the compositor that a piece attaches to. */
export type DisplaySeam =
  | "DisplaySurface"
  | "wayland-server"
  | "composer-hal+bufferqueue"
  | "none";

export interface UxOption {
  id: string;
  name: string;
  mechanism: UxMechanism;
  kind: IntegrationKind;
  repo: string;
  branch: string;
  blurb: string;
  /** One line describing what breaks if picked wrongly. */
  warning?: string;
  /** Pre-selected for this slot in these editions. */
  defaultFor?: Edition[];
  /** Visible but not selectable, with the reason. */
  blocked?: string;
}

export interface UxSlot {
  id: string;
  label: string;
  /** What the choice means for the build. */
  meaning: string;
  required: boolean;
  /** The current selection, honoring edition defaults. */
  selected: string | null;
  options: UxOption[];
}

/** How each mechanism maps onto the display. */
export function classify(e: UxEntry): { kind: IntegrationKind; seam: DisplaySeam } {
  switch (e.mechanism) {
    case "compositor":
      return { kind: "display_owner", seam: "DisplaySurface" };
    case "shell":
      return { kind: "wayland_client", seam: "wayland-server" };
    case "desktop":
      return { kind: "wayland_client", seam: "wayland-server" };
    case "ui_kit":
      return { kind: "theme", seam: "none" };
    case "package_set":
    case "build_system":
      return { kind: "package_source", seam: "none" };
    case "installer":
    case "issue_tracker":
      return { kind: "refuse", seam: "none" };
  }
}

function toOption(e: UxEntry): UxOption {
  const { kind } = classify(e);
  let blocked: string | undefined;
  if (kind === "refuse") {
    blocked = `${e.name} is ${e.mechanism === "installer" ? "an installer" : "an issue tracker"}, not a UI`;
  } else if (e.mechanism === "build_system") {
    blocked = `${e.name} is a build system: pick one of its environments instead`;
  }
  return {
    id: e.id,
    name: e.name,
    mechanism: e.mechanism,
    kind,
    repo: e.url,
    branch: e.branch,
    blurb: e.blurb,
    warning: e.warning,
    defaultFor: e.defaultFor,
    blocked,
  };
}

/**
 * The slots the builder shows, in build order.
 *
 * The chain is three choices, not one:
 *
 *   1. an Android ROM -- always the base, always first. The mobile half of NURFS
 *      is the vendor/firmware half; it comes from here and never from a Linux
 *      tree.
 *   2. a mobile Linux distribution -- the user space that gets fused on top.
 *   3. a UX from that distribution -- filtered to what it can actually install.
 *
 * Steps 1 and 2 come from sources-catalog.json. Step 3 comes from ux-catalog.ts
 * and is narrowed by the distro chosen in step 2.
 */
const SLOT_DEFS: Array<{
  id: string;
  label: string;
  meaning: string;
  required: boolean;
  kinds: IntegrationKind[];
  /** Populated from sources-catalog.json rather than the UX catalog. */
  fromCatalog?: "rom" | "mobile_linux";
}> = [
  {
    id: "base_rom",
    label: "Android base ROM",
    meaning:
      "Always the base. Its vendor/firmware half is the Android side of NURFS; it is never replaced by the Linux side.",
    required: true,
    kinds: [],
    fromCatalog: "rom",
  },
  {
    id: "distro",
    label: "mobile Linux distro",
    meaning:
      "The user space fused onto the Android base. This is what decides which UIs are available.",
    required: true,
    kinds: [],
    fromCatalog: "mobile_linux",
  },
  {
    id: "display_owner",
    label: "display server",
    meaning:
      "Takes DRM and commits the frame. Everything else attaches to it, so there is exactly one.",
    required: true,
    kinds: ["display_owner"],
  },
  {
    id: "shell",
    label: "shell / session",
    meaning: "Supplies surfaces into the display owner's scene. One session.",
    required: false,
    kinds: ["wayland_client"],
  },
  {
    id: "theme",
    label: "theme source",
    meaning: "Tokens the owner loads. Not a session and no surfaces of its own.",
    required: false,
    kinds: ["theme"],
  },
  {
    id: "packages",
    label: "package source",
    meaning: "Where the UI's packages come from, when the UI is a dependency choice.",
    required: false,
    kinds: ["package_source"],
  },
];

export interface CatalogChoice {
  id: string;
  name: string;
  url: string;
  arch?: string[];
  note?: string;
}

/** Read the two source kinds the chain needs out of sources-catalog.json. */
let catalogCache: { rom: CatalogChoice[]; mobile_linux: CatalogChoice[] } | null = null;
function sourceChoices(): { rom: CatalogChoice[]; mobile_linux: CatalogChoice[] } {
  if (catalogCache) return catalogCache;
  try {
    const p = new URL("./sources-catalog.json", import.meta.url);
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const pick = (kind: string): CatalogChoice[] =>
      (doc.sources ?? [])
        .filter((s: any) => s.kind === kind)
        .map((s: any) => ({ id: s.id, name: s.name, url: s.url, arch: s.arch, note: s.note }));
    catalogCache = { rom: pick("rom"), mobile_linux: pick("mobile_linux") };
  } catch {
    catalogCache = { rom: [], mobile_linux: [] };
  }
  return catalogCache;
}

/** Pick the default option for a slot under an edition. */
function defaultSelection(options: UxOption[], edition: Edition): string | null {
  const forEdition = options.find((o) => !o.blocked && o.defaultFor?.includes(edition));
  if (forEdition) return forEdition.id;
  return null;
}

/**
 * The builder's UX array.
 *
 * `selection` is the user's picks keyed by slot id. `distro` narrows the UX
 * options to what that distribution can install, which is the whole point of
 * asking in that order.
 */
export function uxSlots(
  edition: Edition = "mobile_kernel",
  selection: Record<string, string | undefined> = {},
): UxSlot[] {
  const src = sourceChoices();
  const distro = selection.distro;

  const all = UX_CATALOG.map(toOption);
  return SLOT_DEFS.map((d) => {
    // Source-backed slots: the options are catalog entries, not UX entries, so
    // they are passed through as UxOption with the display fields left empty.
    if (d.fromCatalog) {
      const list = src[d.fromCatalog];
      const options: UxOption[] = list.map((c) => ({
        id: c.id,
        name: c.name,
        mechanism: "package_set",
        kind: "package_source",
        repo: c.url,
        branch: "",
        blurb: (c.note ?? "").split(". ")[0] ?? "",
      }));
      const chosen = selection[d.id];
      return {
        id: d.id,
        label: d.label,
        meaning: d.meaning,
        required: d.required,
        selected: options.some((o) => o.id === chosen) ? chosen! : (options[0]?.id ?? null),
        options,
      };
    }

    // UX slots: narrowed by distro when one is chosen.
    let options = all.filter((o) => d.kinds.includes(o.kind));
    if (distro) {
      options = options.filter((o) => {
        const entry = UX_CATALOG.find((e) => e.id === o.id)!;
        // An entry with no distros list is distro-agnostic (themes, the project's
        // own compositor). An entry with a list may only appear for those distros.
        if (!entry.distros || entry.distros.length === 0) return true;
        return entry.distros.includes(distro);
      });
    }

    const chosen = selection[d.id];
    const valid = chosen ? options.find((o) => o.id === chosen && !o.blocked) : undefined;
    return {
      id: d.id,
      label: d.label,
      meaning: d.meaning,
      required: d.required,
      selected: valid?.id ?? defaultSelection(options, edition),
      options,
    };
  });
}

/**
 * What is wrong with a selection set, in the user's terms.
 *
 * Deliberately narrow: it reports gaps that make a build succeed and the image
 * not start (a shell with no owner, two owners, an unserved private protocol), and
 * leaves everything else to the catalog's warnings.
 */
export function uxSelectionProblems(
  slots: UxSlot[],
  selection: Record<string, string | undefined> = {},
): string[] {
  const problems: string[] = [];

  // Only UX slots resolve into catalog entries; the ROM and distro slots are
  // source-catalog ids and are checked as plain presence.
  const chosen = slots
    .map((s) => s.selected)
    .filter((v): v is string => !!v)
    .map((id) => UX_CATALOG.find((e) => e.id === id))
    .filter((e): e is UxEntry => !!e);
  const owner = chosen.find((e) => classify(e).kind === "display_owner");

  for (const slot of slots) {
    if (slot.required && !slot.selected) {
      const why =
        slot.id === "base_rom"
          ? "no Android base ROM chosen: NURFS needs its vendor/firmware half"
          : slot.id === "distro"
            ? "no mobile Linux distro chosen: there is no user space to fuse"
            : "nothing will own the panel";
      problems.push(`${slot.label}: ${why}`);
    }
    const raw = selection[slot.id];
    if (raw) {
      const opt = slot.options.find((o) => o.id === raw);
      if (opt?.blocked) problems.push(opt.blocked);
      if (!opt) problems.push(`${raw} is not available for ${slot.label} in this combination`);
    }
  }

  // A distro that offers no session at all is a real dead end worth stating.
  const shellSlot = slots.find((s) => s.id === "shell");
  const distro = slots.find((s) => s.id === "distro")?.selected;
  if (shellSlot && distro && shellSlot.options.length === 0) {
    problems.push(
      `no session is available for ${distro}: none of the catalog's shells can be installed from it`,
    );
  }

  const shells = chosen.filter((e) => e.mechanism === "shell" || e.mechanism === "desktop");
  for (const sh of shells) {
    if (!owner) {
      problems.push(`${sh.name} is a session and no display server is chosen`);
      continue;
    }
    // What the owner *implements*, not what it demands. Phosh-on-Phoc is the
    // supported pairing precisely because phoc serves these; using the owner's
    // requirements here would report every correct pairing as broken.
    const served = new Set(owner.servesProtocols ?? owner.requiresProtocols ?? []);
    const needs = (sh.requiresProtocols ?? []).filter((p) => !served.has(p));
    if (needs.length) {
      problems.push(
        `${sh.name} needs protocol(s) ${owner.name} does not serve: ${needs.join(", ")}. ` +
          `The image will boot to a black screen rather than fail the build.`,
      );
    }
  }

  // A shell whose companion compositor was not chosen is the most common mistake,
  // so say it by name instead of listing the protocol diff.
  for (const sh of shells) {
    for (const need of sh.requires ?? []) {
      const satisfied = chosen.some(
        (c) => c.id === need || c.name.toLowerCase().includes(need.toLowerCase()),
      );
      if (!satisfied) problems.push(`${sh.name} needs ${need}`);
    }
  }

  return problems;
}

export interface IntegrationStep {
  order: number;
  id: string;
  name: string;
  kind: IntegrationKind;
  seam: DisplaySeam;
  repo: string;
  branch: string;
  /** What this step produces that later ones consume. */
  produces: string;
  /** Protocols the owner must serve for this step to run. */
  needsProtocols?: string[];
  caveats: string[];
}

export interface UxIntegrationPlan {
  ok: boolean;
  edition: Edition;
  steps: IntegrationStep[];
  problems: string[];
  caveats: string[];
  summary: string;
}

/** Where a kind sits in the build: packages and themes before the owner, owners before clients. */
function rank(kind: IntegrationKind): number {
  if (kind === "package_source") return 10;
  if (kind === "theme") return 20;
  if (kind === "display_owner") return 30;
  if (kind === "wayland_client") return 40;
  return 90;
}

/**
 * Turn slot selections into ordered build steps.
 *
 * One value per slot, so there is no "two compositors" case to resolve here -- the
 * picker cannot express it. Ordering still matters: a theme has to exist before
 * the owner loads it, and the owner has to exist before a shell connects.
 */
export function planUxIntegration(
  slots: UxSlot[],
  opts: { edition?: Edition; androidProducers?: boolean } = {},
): UxIntegrationPlan {
  const edition = opts.edition ?? "mobile_kernel";
  const chosen = slots
    .map((s) => s.selected)
    .filter((v): v is string => !!v)
    .map((id) => UX_CATALOG.find((e) => e.id === id)!)
    .filter(Boolean);

  const problems = uxSelectionProblems(slots, {});
  const caveats = chosen.flatMap((e) => (e.warning ? [e.warning] : []));

  const ranked = [...chosen].sort((a, b) => {
    const d = rank(classify(a).kind) - rank(classify(b).kind);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  const steps: IntegrationStep[] = [];
  let order = 1;
  for (const e of ranked) {
    const { kind, seam } = classify(e);
    steps.push({
      order: order++,
      id: e.id,
      name: e.name,
      kind,
      seam: kind === "display_owner" && edition === "mobile_kernel" ? "composer-hal+bufferqueue" : seam,
      repo: e.url,
      branch: e.branch,
      produces:
        kind === "package_source"
          ? `${e.environments?.length ?? 0} selectable environment(s) of packages`
          : kind === "theme"
            ? "resolved token/theme data for the owner to load"
            : kind === "display_owner"
              ? "the DisplaySurface + wayland-server the scene commits through"
              : "client surfaces into the owner's scene",
      needsProtocols: e.mechanism === "desktop" ? undefined : e.requiresProtocols,
      caveats: e.warning ? [e.warning] : [],
    });
  }

  // The Android half is not a fetched repo. On the mobile edition it is the other
  // producer feeding the same scene, so it belongs in the plan as wiring, last.
  const hasOwner = steps.some((s) => s.kind === "display_owner");
  if (hasOwner && opts.androidProducers !== false && edition === "mobile_kernel") {
    steps.push({
      order: order++,
      id: "android-composer-layers",
      name: "Android Composer HAL producers",
      kind: "display_owner",
      seam: "composer-hal+bufferqueue",
      repo: "(in image)",
      branch: "(in image)",
      produces: "bionic surface producers registered as layers in the one scene",
      caveats: [],
    });
  }

  const ok = problems.length === 0 && hasOwner;
  const summary = ok
    ? `${steps.length} step(s): ${steps.map((s) => s.name).join(" -> ")}` +
      (caveats.length ? ` (${caveats.length} caveat(s))` : "")
    : problems.length
      ? `cannot build: ${problems.join("; ")}`
      : "cannot build: no display server chosen";

  return { ok, edition, steps, problems, caveats, summary };
}

/**
 * The grouped catalog, for a picker that shows sections. Kept because it is the
 * view that makes the mechanism distinction legible at a glance.
 */
export function groupedUxChoices() {
  const groups = describeUxChoices();
  return {
    displayServers: groups.standalone.filter((e) => classify(e).kind === "display_owner"),
    shells: groups.dependent.filter((e) => e.mechanism === "shell"),
    themes: groups.dependent.filter((e) => e.mechanism === "ui_kit"),
    packageSources: groups.dependent.filter(
      (e) => e.mechanism === "package_set" || e.mechanism === "build_system",
    ),
    refused: groups.notUx,
  };
}
