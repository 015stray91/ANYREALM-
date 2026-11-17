/**
 * The UX catalog.
 *
 * Every one of these trees is plausibly "a mobile UI", and they are not the same
 * kind of thing. Getting the kind wrong is how a build ends up with a session
 * that starts and paints nothing, so the catalog records the mechanism, not just
 * the name:
 *
 *   compositor  owns DRM and the panel. It *is* the display server.
 *   shell       a Wayland client that expects a specific compositor, often with
 *               private protocols of its own.
 *   ui_kit      no display server and no session: tokens and components, emitted
 *               as data for a renderer to consume.
 *   desktop     a full desktop environment, usable on a phone only if it also
 *               provides or targets one of the above.
 *   package_set a repository of UI *packages*. Choosing one is a dependency
 *               change, not a patch, and this is the model to copy.
 *   installer   a desktop application that writes an OS to a phone. Not a UX.
 *   issue_tracker  documentation only. Not buildable at all.
 *
 * Three trees the user collected turned out to be the last two kinds, which is
 * exactly the trap this catalog exists to make visible.
 */

import fs from "fs";

export type UxMechanism =
  | "compositor"
  | "shell"
  | "ui_kit"
  | "desktop"
  | "package_set"
  | "installer"
  | "issue_tracker"
  | "build_system";

export interface UxEntry {
  id: string;
  name: string;
  mechanism: UxMechanism;
  /** The repo to clone for this piece. */
  url: string;
  branch: string;
  language: string;
  /** True when this can be the only UI piece in an image. */
  standalone: boolean;
  /** For a shell or ui_kit: what it needs underneath it. */
  requires?: string[];
  /** Protocols a compositor must serve before this will run. */
  requiresProtocols?: string[];
  /**
   * Protocols this piece *implements* for others. Only meaningful for a
   * compositor, and the distinction matters: a compositor's `requiresProtocols`
   * is what it demands of whoever hosts it, while `servesProtocols` is what it
   * offers to its clients. Confusing the two makes Phosh-on-Phoc look broken.
   */
  servesProtocols?: string[];
  /** One line a user reads in a picker. */
  blurb: string;
  /** Why it is or is not directly usable as the image's UI. */
  note: string;
  /** Where this came from, when it is a fork. */
  forkOf?: string;
  /** Set when the tree is not what its name suggests. */
  warning?: string;
  /** For a build system: the UI names it can be told to install. */
  environments?: string[];
  /** For a build system: the device families it has package lists for. */
  device_families?: string[];
  /** For a build system: how the choice is expressed on the command line. */
  selection_mechanism?: string;
  /** Extra context where the upstream and the fork differ meaningfully. */
  note_on_upstream?: string;
  /** Editions where this is the pre-selected owner. */
  defaultFor?: Array<"rom" | "desktop_iso" | "mobile_kernel">;
  /**
   * Which mobile Linux distributions can install this UX. A UX is not portable
   * across distros: Phosh is a Debian/modern package set, Lipstick exists only in
   * Sailfish, Lomiri only in Ubuntu Touch. Offering all of them to every distro is
   * how a build produces a session with no binaries behind it.
   */
  distros?: string[];
  /**
   * Protocol revisions this piece implements, when they were checked against the
   * consumer. A version skew here compiles and runs and quietly loses a feature,
   * which is worse than a missing protocol that refuses to start.
   */
  protocolVersions?: Record<string, { version: number; identicalToPhosh: boolean; detail?: string }>;
}

/**
 * The catalog. Ordered so a picker shows the directly-usable options first.
 *
 * Sourcing: every entry here was read from the tree, not from its name. The
 * mechanism field is the conclusion of that reading.
 */
export const UX_CATALOG: UxEntry[] = [
  // --- compositors: these can be the image's display server ------------------
  {
    id: "surfaceflinger",
    name: "SurfaceFlinger (fused host)",
    mechanism: "compositor",
    url: "https://android.googlesource.com/platform/frameworks/native",
    branch: "main (platform/frameworks/native)",
    distros: ["mobian", "postmarketos", "droidian", "ubports", "kali-nethunter-pro", "kali-nethunter", "sailfish", "neon"],
    language: "C++",
    standalone: true,
    blurb: "The mobile default. Android's compositor becomes the one display owner; everything else attaches to it.",
    note:
      "SurfaceFlinger already does not own presentation: it delegates through the DisplaySurface interface " +
      "(beginFrame, prepareFrame(CompositionType), advanceFrame, onFrameCommitted), and CompositionType " +
      "already distinguishes Gpu, Hwc and Mixed. So a UX attaches as a DisplaySurface implementation plus, " +
      "where it draws its own surfaces, a surface source feeding the same scene. Nothing in the composition " +
      "loop is patched, which is why this can be the host for a mobile image rather than a parallel stack. " +
      "On x86_64 desktop it is only meaningful when an Android x86 base is in the image; use the unified " +
      "compositor otherwise.",
    requiresProtocols: ["xdg-shell"],
    servesProtocols: ["xdg-shell"],
    // The desktop edition has no Android half unless rom_x86 is chosen, so this
    // is the mobile default only. The builder still offers it on desktop.
    defaultFor: ["mobile_kernel"],
  },
  {
    id: "nurfs-compositor",
    name: "AnyRealm unified compositor",
    mechanism: "compositor",
    url: "anyrealm-builder/display",
    branch: "(in tree)",
    distros: ["mobian", "postmarketos", "droidian", "ubports", "kali-nethunter-pro", "kali-nethunter", "sailfish", "neon"],
    language: "C++",
    standalone: true,
    blurb: "One process owns DRM and serves the Composer HAL and Wayland from one scene.",
    note:
      "The project's own answer, and the only option that fuses both halves without a second display server. " +
      "It serves Composer HAL entry points and wayland-server in the same process, so there is one scene, one " +
      "atomic commit and no frame hand-off between an Android side and a Linux side. Its core is " +
      "display/nurfs_compositor_core.cpp with 49 behaviour tests; the DRM and protocol front ends are the " +
      "remaining work.",
    requiresProtocols: ["xdg-shell"],
    servesProtocols: ["xdg-shell", "wlr-layer-shell"],
  },
  {
    id: "lipstick",
    name: "Lipstick",
    mechanism: "compositor",
    url: "https://github.com/015stray91/lipstick",
    forkOf: "nemomobile-ux/lipstick",
    branch: "master",
    distros: ["sailfish"],
    language: "C++/QML (Qt6)",
    standalone: true,
    blurb: "Nemo/Sailfish homescreen framework. Subclasses QWaylandCompositor outright.",
    note:
      "A real compositor, so it can be the image's display server. Qt/QML, which makes it the natural host " +
      "for a theme generated from Glacier tokens. Two caveats: the tree is Qt6-only (CMakeLists wants 6.2 " +
      "while the rpm spec is still lipstick-qt5 0.36.29), and it carries an alien_bridge_server notification " +
      "path -- Sailfish's Android-in-a-bridge model, the thing NUKI/NURFS replaces. The notification code is " +
      "what to rewrite, not the compositor.",
    requiresProtocols: ["xdg-shell"],
    servesProtocols: ["xdg-shell"],
    warning: "Serves xdg-shell only. It cannot host Phosh, which needs wlr-layer-shell.",
  },
  {
    id: "lomiri",
    name: "Lomiri (Ubuntu Touch UI)",
    mechanism: "compositor",
    url: "https://github.com/ubports/lomiri",
    branch: "main",
    distros: ["ubports"],
    language: "C++/QML",
    standalone: true,
    blurb: "The actual Ubuntu Touch UX. Not present in the fork collected for this project.",
    note:
      "This is what an Ubuntu Touch integration needs. The tree that was forked " +
      "(015stray91/ubuntu-touch) is the bug tracker, not this. Lomiri is a Wayland compositor, so it can be " +
      "the display server, but it is a full session and cannot be layered on the unified compositor without " +
      "work.",
    requiresProtocols: ["xdg-shell", "wlr-layer-shell"],
    servesProtocols: ["xdg-shell", "wlr-layer-shell"],
  },

  {
    id: "phoc",
    name: "Phoc",
    mechanism: "compositor",
    url: "https://github.com/015stray91/phoc",
    forkOf: "PhoshMobi/phoc",
    branch: "main",
    distros: ["mobian", "postmarketos", "droidian", "kali-nethunter-pro"],
    language: "C (wlroots)",
    standalone: true,
    blurb: "The wlroots compositor Phosh is written against. Serves Phosh's private protocols.",
    note:
      "Phosh's companion compositor and the only thing that serves its private protocols out of the box. " +
      "It implements four that matter: phosh-private (32 interfaces/requests/events), " +
      "phoc-device-state-unstable-v1, phoc-layer-shell-effects-unstable-v1, plus two of its own " +
      "(phoc-foreign-toplevel-identifier-v1, phoc-foreign-toplevel-pidfd-v1) and xx-cutouts-v1. It is a full " +
      "display server, so it competes with the unified compositor rather than sitting under it: pairing Phosh " +
      "with this is the supported path, and putting Phosh on the unified compositor means implementing those " +
      "protocols there.",
    requiresProtocols: ["xdg-shell", "wlr-layer-shell"],
    servesProtocols: ["xdg-shell", "wlr-layer-shell", "wlr-foreign-toplevel-management", "wlr-screencopy", "wlr-output-power-management", "gtk-shell", "input-method-unstable-v2", "phosh-private", "phoc-device-state-unstable-v1", "phoc-layer-shell-effects-unstable-v1", "phoc-foreign-toplevel-identifier-v1", "phoc-foreign-toplevel-pidfd-v1", "xx-cutouts-v1", "wlr-output-management", "virtual-keyboard-unstable-v1", "wlr-gamma-control-unstable-v1", "ext-idle-notify-v1"],
    protocolVersions: {
      // Verified by diffing the fork's copies against phosh-ux's at the same commit.
      "phosh-private": { version: 8, identicalToPhosh: true },
      "phoc-layer-shell-effects-unstable-v1": { version: 1, identicalToPhosh: true },
      "phoc-device-state-unstable-v1": {
        version: 2,
        identicalToPhosh: false,
        detail:
          "Phoc's copy is version 2 and adds a 'keyboard' capability (value 4, since 2) for a hardware " +
          "keyboard. phosh-ux's copy is version 1 and does not have it. They still pair -- phosh only binds " +
          "v1 -- but phosh cannot see keyboard-attached state, so docked/keyboard-mode behaviour is lost " +
          "until phosh rebinds at version 2.",
      },
    },
    warning:
      "The device-state protocols in the two forks are NOT the same revision. Pairing them works but silently " +
      "drops hardware-keyboard detection.",
  },
  {
    id: "kwin",
    name: "KWin (Wayland)",
    mechanism: "compositor",
    url: "https://invent.kde.org/plasma/kwin",
    branch: "master",
    distros: ["neon", "postmarketos", "mobian"],
    language: "C++ (Qt6)",
    standalone: true,
    blurb: "Plasma's compositor. What Plasma Mobile runs on.",
    note:
      "A full Wayland display server. Plasma Mobile is a shell on top of it, so Plasma Mobile plus KWin is a " +
      "complete session; Plasma Mobile alone is not.",
    requiresProtocols: ["xdg-shell", "wlr-layer-shell"],
    servesProtocols: ["xdg-shell", "wlr-layer-shell", "wlr-foreign-toplevel-management", "wlr-screencopy", "input-method-unstable-v2", "plasma-shell"],
  },
  {
    id: "sway",
    name: "Sway",
    mechanism: "compositor",
    url: "https://github.com/swaywm/sway",
    branch: "master",
    distros: ["postmarketos", "mobian", "droidian", "kali-nethunter-pro"],
    language: "C (wlroots)",
    standalone: true,
    blurb: "Tiling wlroots compositor. The base SXMO's sway flavour expects.",
    note:
      "A small, complete Wayland compositor. Useful here beyond SXMO: it is the cheapest way to prove a new " +
      "protocol front end or a generated theme works, without a phone-specific stack.",
    requiresProtocols: ["xdg-shell", "wlr-layer-shell"],
    servesProtocols: ["xdg-shell", "wlr-layer-shell", "wlr-foreign-toplevel-management", "wlr-screencopy", "wlr-output-management", "wlr-gamma-control-unstable-v1", "virtual-keyboard-unstable-v1", "ext-idle-notify-v1"],
  },

  // --- shells: need a specific compositor underneath -------------------------
  {
    id: "phosh-ux",
    name: "Phosh",
    mechanism: "shell",
    url: "https://github.com/015stray91/phosh-ux",
    forkOf: "PhoshMobi/phosh",
    branch: "main",
    distros: ["mobian", "postmarketos", "droidian", "kali-nethunter-pro"],
    language: "C (GTK3)",
    standalone: false,
    requires: ["phoc"],
    requiresProtocols: [
      "xdg-shell",
      "wlr-layer-shell",
      "wlr-foreign-toplevel-management",
      "wlr-output-management",
      "wlr-screencopy",
      "ext-idle-notify-v1",
      "phosh-private",
      "phoc-device-state-unstable-v1",
      "phoc-layer-shell-effects-unstable-v1",
      "virtual-keyboard-unstable-v1",
      "input-method-unstable-v2",
    ],
    blurb: "The NH-Pro session shell. A Wayland client, not a display server.",
    note:
      "Its README says the companion compositor is phoc, and protocol/meson.build lists three private " +
      "protocols phoc implements (phosh-private, phoc-device-state, phoc-layer-shell-effects). So it runs on " +
      "phoc unless another compositor implements those. That is the work item if Phosh is wanted on the " +
      "unified compositor.",
  },
  {
    id: "plasma-mobile",
    name: "Plasma Mobile",
    mechanism: "shell",
    url: "https://github.com/015stray91/Kde-plasma-mobile",
    forkOf: "KDE/plasma-mobile",
    branch: "master",
    distros: ["mobian", "postmarketos", "neon", "kali-nethunter-pro"],
    language: "C++/QML",
    standalone: false,
    requires: ["kwin"],
    requiresProtocols: ["xdg-shell", "wlr-layer-shell"],
    blurb: "Plasma's phone shell. Runs on KWin Wayland.",
    note:
      "bin/startplasmamobile.in ends in startplasma-wayland and sets EGL_PLATFORM=wayland / " +
      "PLASMA_PLATFORM=phone:handset, so it is a Wayland client shell. It needs KWin or a compositor that " +
      "serves what it expects; it is not the display server.",
  },
  {
    id: "sxmo",
    name: "SXMO",
    mechanism: "shell",
    url: "https://git.sr.ht/~mil/sxmo-utils",
    branch: "master",
    distros: ["postmarketos"],
    language: "shell/dwm/sway",
    standalone: false,
    requires: ["sway"],
    blurb: "A deliberately minimal, keyboard-and-menu driven phone UX built on sway.",
    note:
      "postmarketOS ships it as postmarketos-ui-sxmo-de-sway (and a dwm variant). It is a set of scripts " +
      "around a tiling compositor, so it is a shell: sway stays the display server. Worth offering because " +
      "it is the lightest real option and it proves the compositor boundary without needing a phone-specific " +
      "protocol.",
  },

  {
    id: "mobian",
    name: "Mobian",
    mechanism: "build_system",
    url: "https://github.com/015stray91/mobian",
    forkOf: "tabletseeker/mobian",
    branch: "master",
    distros: ["mobian"],
    language: "YAML + shell (debos)",
    standalone: false,
    blurb: "A Debian image builder whose UI is chosen at build time: -e phosh or -e plasma-mobile.",
    note:
      "This is the closest thing in the collection to what AnyRealm's builder is doing, and worth copying " +
      "rather than wrapping. The UI is not hard-coded: every recipe starts with " +
      "`{{- $environment := or .environment \"phosh\" -}}`, build.sh takes `-e <environment>`, and each device " +
      "family carries devices/<family>/packages-<environment>.yaml (amd64, librem5, qcom, rockchip, sunxi x " +
      "phosh, plasma-mobile). The output filename even carries the choice: " +
      "rootfs-<device>-<environment>.tar.gz. So a UI is a package list selected by name -- exactly the array " +
      "of UX choices the builder needs.",
    environments: ["phosh", "plasma-mobile", "base", "base-installer", "fde"],
    device_families: ["amd64", "librem5", "qcom", "rockchip", "sunxi"],
    selection_mechanism: "build.sh -e <environment> -> include/packages-<environment>.yaml and devices/<family>/packages-<environment>.yaml",
    note_on_upstream:
      "The fork's README describes a Debian-only, x86_64-touch-device-focused variant that also claims ARM " +
      "phones. It declares no third-party repositories, which is a good match for a base NURFS rootfs.",
  },

  // --- ui kits: data, not a session -----------------------------------------
  {
    id: "glacierui",
    name: "Glacier UI",
    mechanism: "ui_kit",
    url: "https://github.com/015stray91/GlacierUI",
    forkOf: "InfamousVague/GlacierUI",
    branch: "main",
    distros: ["mobian", "postmarketos", "droidian", "ubports", "kali-nethunter-pro", "kali-nethunter", "sailfish", "neon"],
    language: "TypeScript",
    standalone: false,
    requires: ["compositor"],
    blurb: "Token-first UI kit. Emits spec.json plus a JSON Schema a native renderer consumes.",
    note:
      "Not a display server and not a session: 113 component specs, 285 tokens, and a generated QML theme via " +
      "glacier-qml-bridge.ts. It supplies the look, so it pairs with a compositor/shell rather than replacing " +
      "one. Two spec defects found while binding it: Divider names font-family-sans (real token: font-sans) " +
      "and four components name surface-hover (real token: hover).",
  },

  // --- package sets: the model to copy --------------------------------------
  {
    id: "pmaports",
    name: "postmarketOS aports",
    mechanism: "package_set",
    url: "https://github.com/015stray91/pmaports",
    forkOf: "postmarketOS/pmaports",
    branch: "danila/courbet",
    distros: ["postmarketos"],
    language: "APKBUILD",
    standalone: false,
    blurb: "21 selectable UIs, each a package. The right model for 'compose your own desktop'.",
    note:
      "Not a UX itself: the UI is a dependency, not a patch (postmarketos-ui-phosh, -plasma-mobile, -sxmo, " +
      "-gnome-mobile, -sway, -weston, -asteroid, ...). 114 packages in main/. This is how the builder should " +
      "offer UX choice: pick a package, do not weave a patch.",
    warning:
      "The checked-out branch is danila/courbet ('xiaomi-courbet: new device'), a single-device branch. " +
      "Building from it yields a Xiaomi Courbet tree, not a general one -- rebranch before using it as a source.",
  },

  // --- not UX at all, recorded so they are not picked by name ---------------
  {
    id: "ubports-installer",
    name: "UBports Installer",
    mechanism: "installer",
    url: "https://github.com/015stray91/ubports-installer",
    forkOf: "ubports/ubports-installer",
    branch: "master",
    distros: [],
    language: "JavaScript/Svelte (Electron)",
    standalone: false,
    blurb: "A desktop app that flashes Ubuntu Touch to a phone. Not a phone UI.",
    note:
      "Useful for its plugin contract, not its UI: flavours subclass src/core/plugins/plugin.js with " +
      "init() -> Promise<boolean>, kill() -> Promise, wait() -> CancelablePromise<string>, and are " +
      "registered by key in plugins/index.js (adb, fastboot, heimdall, systemimage, asteroid_os, lineage_os, " +
      "postmarketos, core). AnyRealm's builder wants the same shape: a mobile_kernel edition is one more " +
      "flavour, not a fork of the app.",
    warning: "Cannot be an image's UI: it runs on a computer, not the phone.",
  },
  {
    id: "ubuntu-touch",
    name: "ubuntu-touch (tracker)",
    mechanism: "issue_tracker",
    url: "https://github.com/015stray91/ubuntu-touch",
    forkOf: "ubports/ubuntu-touch",
    branch: "master",
    distros: [],
    language: "(none)",
    standalone: false,
    blurb: "Eight markdown files. The Ubuntu Touch bug tracker, not its UX.",
    note:
      "Zero source files of any language: README, CONTRIBUTING, CODE_OF_CONDUCT, CORE_APPS, SUPPORT, two " +
      "templates and FUNDING. Upstream's README says it tracks bugs and feature requests. Nothing here can " +
      "be built into an image.",
    warning:
      "Not buildable. The Ubuntu Touch UI is Lomiri (ubports/lomiri), which is a separate tree and is not in " +
      "this fork.",
  },
];

export interface UxChoiceReport {
  /** Entries that can be the image's only UI piece. */
  standalone: UxEntry[];
  /** Entries that need something underneath, with what they need. */
  dependent: UxEntry[];
  /** Entries that cannot be a UI at all. */
  notUx: UxEntry[];
  /** Builders that express the UI as a package-list choice. */
  buildSystems: UxEntry[];
  /** For a chosen combination, what is still missing. */
  missingRequirements: string[];
}

/**
 * Group the catalog and report what a chosen set of UX ids still needs.
 *
 * The point of the second half is to answer "if I pick Phosh, what else do I have
 * to pick?" before a build starts rather than after a blank screen.
 */
export function describeUxChoices(chosen: string[] = []): UxChoiceReport {
  const byId = new Map(UX_CATALOG.map((e) => [e.id, e]));

  const standalone = UX_CATALOG.filter((e) => e.standalone);
  const dependent = UX_CATALOG.filter(
    (e) => !e.standalone && e.mechanism !== "installer" && e.mechanism !== "issue_tracker",
  );
  const notUx = UX_CATALOG.filter(
    (e) => e.mechanism === "installer" || e.mechanism === "issue_tracker",
  );
  // A build system is not a UI, but it is also not a mistake to pick: it is how
  // a UI gets installed. It belongs in its own group so a picker does not offer
  // it as a look.
  const buildSystems = UX_CATALOG.filter((e) => e.mechanism === "build_system");

  const missing = new Set<string>();
  for (const id of chosen) {
    const e = byId.get(id);
    if (!e) {
      missing.add(`unknown ux id: ${id}`);
      continue;
    }
    if (e.mechanism === "installer" || e.mechanism === "issue_tracker") {
      missing.add(`${e.id} is a ${e.mechanism.replace("_", " ")}, not a UI`);
    }
    if (e.mechanism === "build_system") {
      // Picking a build system supplies no look by itself; it needs a UI name.
      // Say so in the terms that builder uses, so the fix is obvious.
      const envs = e.environments ?? [];
      missing.add(
        `${e.id} is a build system: choose one of its environments (${envs.join(", ")}) rather than using it as a UI`,
      );
    }
    for (const r of e.requires ?? []) {
      // A requirement is satisfied when any chosen entry provides it, either by
      // being a compositor with a matching name or by being listed as chosen.
      const satisfied = chosen.some((c) => {
        if (c === r) return true;
        const ce = byId.get(c);
        return ce !== undefined && (ce.name.toLowerCase().includes(r) || ce.id === r);
      });
      if (!satisfied) missing.add(`${e.id} needs ${r}`);
    }
  }

  return {
    standalone,
    dependent,
    notUx,
    buildSystems,
    missingRequirements: [...missing].sort(),
  };
}

/** Load the catalog from disk, so a deployment can extend it without a rebuild. */
export function loadUxCatalog(file?: string): UxEntry[] {
  if (!file) return UX_CATALOG;
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(doc) ? doc : doc.ux ?? doc.entries;
    return Array.isArray(list) ? (list as UxEntry[]) : UX_CATALOG;
  } catch {
    return UX_CATALOG;
  }
}
