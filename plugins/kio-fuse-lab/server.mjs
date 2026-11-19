/**
 * KIO-FUSE pipeline.
 *
 * What kio-fuse actually is: a FUSE filesystem that gives a KIO URL a path on
 * disk. `smb://nas/share/x.iso` becomes something like
 * `/run/user/1000/kio-fuse-XXXX/smb/nas/share/x.iso`, which is the only reason
 * a program that was never written for KIO (ffmpeg, HandBrake, a shell script,
 * an archiver) can open a remote file from dolphin at all.
 *
 * The pipeline is a build, not a config: fetch, deps, configure, compile,
 * install, verify. Each stage is a step with its own command, its own success
 * test, and a reason it exists.
 *
 * THE ONE THING THAT BREAKS BUILDS: there are two incompatible source lines.
 *
 *   kio-fuse 5.x   Qt5 + KF5 (KF5KIO, KF5CoreAddons)   -> distro KDE Plasma 5
 *   kio-fuse 6.x   Qt6 + KF6 (KF6KIO, KF6CoreAddons)   -> Plasma 6
 *
 * They are not forward-compatible: a 6.x build against KF5 headers fails at
 * `find_package(KF6 ...)`, and a 5.x build linked against KF6 headers compiles
 * and then fails at runtime when the ABI does not match. Ubuntu 24.04 still
 * ships Plasma 5 by default, so choosing wrong is easy and the error is
 * misleading. This module picks the line from the target's actual KF version
 * rather than guessing, and says which one it picked and why.
 *
 * Everything here is a plan. Nothing executes a build.
 */

import fs from "fs";
import path from "path";

/**
 * The two source lines, with the dependency names each one actually needs.
 * A missing package name is a build that dies at cmake, so these are per-family
 * rather than one union list.
 */
const LINES = [
  {
    id: "kf5",
    label: "kio-fuse 5.x — Qt5 / KF5 (Plasma 5)",
    branch: "5.0",
    upstream: "https://invent.kde.org/system/kio-fuse.git",
    /**
     * The version of kio-fuse this line builds. Stated because "latest" from a
     * branch is not a pin, and a moved branch changes what a rebuild produces.
     */
    expectedVersion: "5.x",
    deps: {
      debian: ["cmake", "extra-cmake-modules", "fuse3", "libfuse3-dev", "pkg-config", "libkf5kio-dev", "libkf5coreaddons-dev", "qtbase5-dev", "build-essential"],
      fedora: ["cmake", "extra-cmake-modules", "fuse3-devel", "kf5-kio-devel", "kf5-kcoreaddons-devel", "qt5-qtbase-devel", "pkgconf", "gcc-c++", "make"],
      arch: ["base-devel", "fuse3", "cmake", "extra-cmake-modules", "qt5-base", "kio"],
    },
    cmakeArgs: ["-DCMAKE_BUILD_TYPE=Release", "-DQT_MAJOR_VERSION=5", "-DKDE_INSTALL_USE_QT_SYS_PATHS=ON"],
    runtimeDeps: ["fuse3", "libkf5kio", "libkf5coreaddons", "qt5-qtbase"],
  },
  {
    id: "kf6",
    label: "kio-fuse 6.x — Qt6 / KF6 (Plasma 6)",
    branch: "master",
    upstream: "https://invent.kde.org/system/kio-fuse.git",
    expectedVersion: "6.x",
    deps: {
      debian: ["cmake", "extra-cmake-modules", "fuse3", "libfuse3-dev", "pkg-config", "libkf6kio-dev", "libkf6coreaddons-dev", "qt6-base-dev", "libqt6dbus6", "build-essential"],
      fedora: ["cmake", "extra-cmake-modules", "fuse3-devel", "kf6-kio-devel", "kf6-kcoreaddons-devel", "qt6-qtbase-devel", "pkgconf", "gcc-c++", "make"],
      arch: ["base-devel", "fuse3", "cmake", "extra-cmake-modules", "qt6-base", "kio"],
    },
    cmakeArgs: ["-DCMAKE_BUILD_TYPE=Release", "-DQT_MAJOR_VERSION=6", "-DKDE_INSTALL_USE_QT_SYS_PATHS=ON"],
    runtimeDeps: ["fuse3", "libkf6kio", "libkf6coreaddons", "qt6-qtbase"],
  },
];

/**
 * What the app-side of this pipeline looks like. A pipeline step is only honest
 * if it says how you know it worked — so every step carries `check`, and the
 * check is a command whose exit status is meaningful, not a hopeful echo.
 */
const STAGES = [
  {
    id: "probe",
    title: "Identify the target's KDE line",
    why:
      "Qt5 and Qt6 builds are not interchangeable. Reading the installed KF major version is the only way to " +
      "pick the line without guessing, and getting it wrong fails at cmake with a message about KF6 not being found.",
    command: "pacman -Q kio kcoreaddons 2>/dev/null || dpkg -l 'libkf[56]*-dev' 2>/dev/null | awk '/^ii/{print $2}' | head",
    check: "test -n \"$(dpkg -l 'libkf5kio-dev' 2>/dev/null | awk '/^ii/{print $2}')$(dpkg -l 'libkf6kio-dev' 2>/dev/null | awk '/^ii/{print $2}')\"",
    checkMeans: "at least one KIO development package is installed, so one line has a chance of configuring",
    mutates: false,
  },
  {
    id: "fetch",
    title: "Fetch the source at the chosen branch",
    why:
      "The branch is the pin. Building from a moving branch is why a rebuild of the same commit can produce a " +
      "different binary after a release.",
    command: "git clone --depth 1 --branch <branch> <upstream> kio-fuse",
    check: "test -f kio-fuse/CMakeLists.txt",
    checkMeans: "the clone landed and has a top-level CMakeLists",
    mutates: true,
  },
  {
    id: "deps",
    title: "Install the build dependencies for that line",
    why:
      "The dependency set differs per line and per distro. Installing the union wastes space; installing the " +
      "wrong half fails at cmake on a missing KF5/KF6 package.",
    command: "<distro install command from the chosen line>",
    check: "pkg-config --exists fuse3 && echo ok",
    checkMeans: "fuse3 development headers are visible to pkg-config, which CMakeLists requires first",
    mutates: true,
  },
  {
    id: "configure",
    title: "Configure with CMake",
    why:
      "This is where the line is actually enforced: find_package(KF5|KF6) fails here if the headers on the " +
      "machine do not match the branch. Fixing it here is minutes; fixing it at runtime is a mystery crash.",
    command: "cmake -S kio-fuse -B kio-fuse/build <cmakeArgs>",
    check: "test -f kio-fuse/build/CMakeCache.txt",
    checkMeans: "CMake produced a cache, so dependency resolution succeeded",
    mutates: true,
  },
  {
    id: "compile",
    title: "Compile",
    why: "A single target, small enough that parallel jobs do not matter much, but -j still helps.",
    command: "cmake --build kio-fuse/build -j$(nproc)",
    check: "test -x kio-fuse/build/src/kio-fuse || test -x kio-fuse/build/bin/kio-fuse",
    checkMeans: "a kio-fuse executable exists in the build tree",
    mutates: true,
  },
  {
    id: "install",
    title: "Install",
    why:
      "kio-fuse runs from the KDE libexec/prefix. Installing into a prefix KDE does not search means the daemon " +
      "is never started and every remote path silently stays a URL.",
    command: "sudo cmake --install kio-fuse/build",
    check: "command -v kio-fuse >/dev/null || test -x \"$(qtpaths --install-prefix 2>/dev/null)/libexec/kio-fuse\" 2>/dev/null",
    checkMeans: "kio-fuse resolves on PATH or under the KDE install prefix",
    mutates: true,
  },
  {
    id: "verify",
    title: "Verify a real mount",
    why:
      "The only proof is a path that exists. A daemon that starts and mounts nothing looks identical to a " +
      "working one in ps.",
    command: "kio-fuse -d /tmp/kio-fuse-test &  sleep 2;  ls /tmp/kio-fuse-test;  fusermount3 -u /tmp/kio-fuse-test",
    check: "test -d /tmp/kio-fuse-test",
    checkMeans: "a directory was mounted; if it is empty, no KIO URL has been opened yet and that is expected",
    mutates: true,
  },
];

/** Where kio-fuse mounts by default; the path apps end up seeing. */
const RUNTIME_FACTS = [
  "Mount root is under $XDG_RUNTIME_DIR (usually /run/user/<uid>), not /tmp — /tmp can be cleaned while a file is open.",
  "The daemon is D-Bus activated. If KIO is present and the service file installed, opening a remote URL in dolphin starts it; there is no unit to enable.",
  "A path only appears after something opens the URL through KIO. An empty mount root is normal, not a failure.",
  "fuse3 must be usable by the user: /dev/fuse present, and the user in a group allowed to mount (the default on desktop distros).",
  "On a fused NURFS rootfs, the daemon's service file and libexec binary must both land in the merged tree, or D-Bus activation finds nothing.",
];

export async function register(ctx) {
  const workDir = ctx.workDir();

  ctx.route("/pipeline", (req, res) => {
    const body = req.body ?? {};
    const requested = String(body.line ?? "").trim();
    const line = LINES.find((l) => l.id === requested) ?? null;

    res.json({
      lines: LINES.map((l) => ({
        id: l.id,
        label: l.label,
        branch: l.branch,
        upstream: l.upstream,
        expectedVersion: l.expectedVersion,
        cmakeArgs: l.cmakeArgs,
        runtimeDeps: l.runtimeDeps,
        dependencyCount: {
          debian: l.deps.debian.length,
          fedora: l.deps.fedora.length,
          arch: l.deps.arch.length,
        },
      })),
      /**
       * Stages are returned for the chosen line, with placeholders substituted.
       * A pipeline the UI cannot render is a pipeline nobody follows, so the
       * text here is final — not a template with <branch> left in it.
       */
      stages: STAGES.map((s) => {
        let command = s.command;
        if (line) {
          command = command
            .replace("<branch>", line.branch)
            .replace("<upstream>", line.upstream)
            .replace("<cmakeArgs>", line.cmakeArgs.join(" "))
            .replace("<distro install command from the chosen line>", installCommand(line, body.distro));
        }
        return { ...s, command };
      }),
      dependencies: line ? line.deps : null,
      runtimeFacts: RUNTIME_FACTS,
      /** What happens if the line is wrong — the failure people actually hit. */
      pitfalls: [
        {
          id: "line-mismatch",
          symptom: "cmake: Could not find a package configuration file provided by \"KF6\"",
          cause: "a 6.x source tree configured against a Plasma 5 machine (or the reverse)",
          fix: "switch the line to match the installed KDE; do not try to satisfy KF6 on a KF5 system",
        },
        {
          id: "no-daemon",
          symptom: "remote paths stay as smb:// URLs and no /run/user/<uid>/kio-fuse-* appears",
          cause: "kio-fuse installed to a prefix KDE does not search, so D-Bus activation never finds the binary",
          fix: "install with KDE_INSTALL_USE_QT_SYS_PATHS=ON, or install to the same prefix `qtpaths --install-prefix` reports",
        },
        {
          id: "empty-root",
          symptom: "the mount directory exists and is empty",
          cause: "nothing has opened a KIO URL yet; kio-fuse only materialises paths on demand",
          fix: "open a remote file in dolphin first, then look again — an empty root is not a failure",
        },
        {
          id: "no-fuse",
          symptom: "kio-fuse starts and immediately exits; dmesg or stderr mentions /dev/fuse",
          cause: "the fuse3 module is absent, /dev/fuse is not passed into the container, or the user cannot mount",
          fix: "check `ls -l /dev/fuse` and `fusermount3 --version`; in a container, pass --device /dev/fuse",
        },
      ],
      note:
        "Nothing here runs. These are the exact commands and the test that decides each stage passed, so a " +
        "compile can be dispatched by the Compile Router when you are ready.",
    });
  });

  /**
   * A lockfile is what turns "build again" into "build the same thing again".
   * Recording the line, branch, cmake args and dep list means a later build can
   * be reproduced instead of re-derived.
   */
  ctx.route("/lockfile", (req, res) => {
    if (req.method === "GET") {
      const p = path.join(workDir, "kio-fuse.lock.json");
      if (!fs.existsSync(p)) return res.json({ lockfile: null });
      try {
        return res.json({ lockfile: JSON.parse(fs.readFileSync(p, "utf8")) });
      } catch (e) {
        return res.status(500).json({ error: `lockfile unreadable: ${e.message}` });
      }
    }

    const body = req.body ?? {};
    const line = LINES.find((l) => l.id === body.line);
    if (!line) return res.status(400).json({ error: `line must be one of ${LINES.map((l) => l.id).join(", ")}` });

    const lock = {
      version: 1,
      line: line.id,
      branch: line.branch,
      upstream: body.upstream || line.upstream,
      cmakeArgs: line.cmakeArgs,
      distro: body.distro || "debian",
      dependencies: line.deps[body.distro] ?? line.deps.debian,
      // The resolved commit is the real pin; the branch alone is not.
      commit: body.commit ?? null,
      writtenAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(workDir, "kio-fuse.lock.json"), JSON.stringify(lock, null, 2));
    res.json({ ok: true, lockfile: lock });
  });

  /** Which line does an installed set of packages imply? Read-only. */
  ctx.route("/detect", (_req, res) => {
    const kf5 = !!ctx.which("kf5-config");
    const kf6 = !!ctx.which("kf6-config");
    let verdict = "unknown";
    let why = "neither kf5-config nor kf6-config is on PATH, so the line has to be chosen by hand";
    if (kf5 && !kf6) {
      verdict = "kf5";
      why = "kf5-config is present and kf6-config is not, so this looks like a Plasma 5 machine";
    } else if (kf6 && !kf5) {
      verdict = "kf6";
      why = "kf6-config is present and kf5-config is not, so this looks like a Plasma 6 machine";
    } else if (kf5 && kf6) {
      verdict = "ambiguous";
      why = "both KF5 and KF6 are installed; the line must match the KIO the app will actually load";
    }
    res.json({
      verdict,
      why,
      tools: { kf5: kf5, kf6: kf6, cmake: !!ctx.which("cmake"), fuse3: !!ctx.which("fusermount3") },
    });
  });
}

function installCommand(line, distro) {
  const d = String(distro ?? "debian");
  if (d === "debian") return `sudo apt install -y ${line.deps.debian.join(" ")}`;
  if (d === "fedora") return `sudo dnf install -y ${line.deps.fedora.join(" ")}`;
  if (d === "arch") return `sudo pacman -S --needed ${line.deps.arch.join(" ")}`;
  return `<choose a distro: debian, fedora or arch>`;
}
