#!/usr/bin/env bash
# Prepare a blank Ubuntu 24.04 x86_64 box to build AnyRealm on.
#
# Run this on the build VM, not on a workstation:
#
#   scp scripts/vm-bootstrap.sh scripts/vm-repos.list slm015@HOST:~/
#   ssh slm015@HOST 'bash ~/vm-bootstrap.sh'
#
# It is safe to run twice. Every step checks first and skips what is already
# there, so a half-finished run is resumed rather than repeated. Nothing is
# deleted, and it never touches a scheduled shutdown -- see the bottom of the
# file for how to check that.
#
# What it deliberately does NOT do: download firmware, AOSP trees, or the
# DarkMatter ISO. Those are large, are user-supplied, and belong on the SSD once
# you have them. repo-forge/scripts/vm-stage.sh handles receiving them.

set -euo pipefail

ROOT="${ANYREALM_ROOT:-$HOME}"
SCRATCH="${ANYREALM_SCRATCH:-/mnt}"
JOBS="${JOBS:-4}"

say() { printf '\n== %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 1. Host shape. Record what we are actually building on, because a build that
#    silently ran on 1 vCPU or with no scratch disk produces failures that look
#    like source bugs.
# ---------------------------------------------------------------------------
say "Host"
echo "  kernel   $(uname -r)  $(uname -m)"
echo "  cpus     $(nproc)   (expecting ${JOBS} jobs)"
echo "  memory   $(awk '/MemTotal/{printf "%.1f GiB", $2/1048576}' /proc/meminfo)"
echo "  root fs  $(df -h / | awk 'NR==2{print $4" free of "$2}')"

if [ "$(uname -m)" != "x86_64" ]; then
  echo "  WARNING: expected x86_64. The desktop ISO target is x86_64." >&2
fi

# ---------------------------------------------------------------------------
# 2. Packages. `--no-install-recommends` keeps the image lean; every package
#    listed is reachable by name from the project's build scripts.
# ---------------------------------------------------------------------------
say "Packages"
PKGS=(
  # ISO assembly: xorriso writes the El Torito UEFI entry, squashfs-tools makes
  # system.sfs when a composition still wants one, mtools writes the ESP image.
  xorriso squashfs-tools mtools dosfstools
  # Image and firmware work: no root needed to unpack a boot image, and qemu
  # runs the produced disk images for testing.
  qemu-system-x86 qemu-utils qemu-user-static
  # debos needs a Debian-ish userland toolset inside the image it builds.
  debootstrap fakeroot fakechroot
  # debos' own build dependencies, from its Dockerfile: its ostree binding is
  # cgo and shells out to pkg-config, so without these `go install` fails with
  # `pkg-config: executable file not found` rather than anything about debos.
  pkg-config libglib2.0-dev libostree-dev
  # Cross toolchain: the mobile target is arm64 and this host is x86_64.
  gcc-aarch64-linux-gnu binutils-aarch64-linux-gnu
  # Kernel build prerequisites.
  build-essential bc bison flex libssl-dev libelf-dev libncurses-dev
  rsync unzip zip xz-utils lz4 zstd cpio
  git curl wget jq python3 python3-venv
  # Gradle's own prerequisites for the APK, and a JDK for the desktop's
  # electron-builder step.
  openjdk-17-jdk-headless openjdk-21-jdk-headless
)
MISSING=()
for p in "${PKGS[@]}"; do
  dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "  installing ${#MISSING[@]} packages"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${MISSING[@]}"
else
  echo "  all ${#PKGS[@]} already present"
fi

# debos is not in Ubuntu 24.04 at all, so it is built from source. Its go.mod
# requires Go 1.24 while 24.04 packages 1.22, which fails with "go.mod requires
# go >= 1.24" rather than anything about debos. The toolchain is therefore
# taken from upstream Go, matching debos' own requirement.
if ! have debos; then
  say "debos (built from source; upstream Go toolchain)"
  GO_VER=1.24.0
  if ! have go || ! go version | grep -q "go1\.2[4-9]\|go1\.[3-9][0-9]"; then
    if [ ! -x /usr/local/go/bin/go ]; then
      echo "  fetching go${GO_VER}"
      curl -fsSL "https://go.dev/dl/go${GO_VER}.linux-amd64.tar.gz" -o /tmp/go.tgz
      sudo rm -rf /usr/local/go
      sudo tar -C /usr/local -xzf /tmp/go.tgz
      rm -f /tmp/go.tgz
    fi
    export PATH="/usr/local/go/bin:$PATH"
  fi
  echo "  go       $(go version)"
  # GOFLAGS keeps the module cache inside the build user's home, so this does
  # not need root and survives as a normal cache for later rebuilds.
  GOBIN="$HOME/.local/bin" go install github.com/go-debos/debos/cmd/debos@latest
  sudo install -m 0755 "$HOME/.local/bin/debos" /usr/local/bin/debos
fi
echo "  debos    $(debos --version 2>&1 | head -1 || echo 'version flag unsupported')"

# ---------------------------------------------------------------------------
# 3. Bun, which runs the server. Installed per-user, not system-wide, so the
#    usual shell PATH works without sudo.
# ---------------------------------------------------------------------------
say "Bun"
if have bun; then
  echo "  $(bun --version)"
else
  curl -fsSL https://bun.sh/install | bash >/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
  echo "  installed $(bun --version) (add ~/.bun/bin to PATH in new shells)"
fi
export PATH="$HOME/.bun/bin:$PATH"

# ---------------------------------------------------------------------------
# 4. Scratch. The ephemeral NVMe at /mnt is far faster than the OS disk but is
#    wiped on deallocation, so it holds intermediates only. Build output that
#    must survive goes under $HOME.
# ---------------------------------------------------------------------------
say "Scratch"
# The Dsv4 shape is advertised with an ephemeral NVMe at /mnt, but on this VM /mnt
# is an ordinary directory on the OS disk: lsblk shows only sda. Writing build
# intermediates to a plain /mnt would look like fast local storage while actually
# consuming the disk that has to hold the artefacts, so the fallback is explicit.
if mountpoint -q "$SCRATCH"; then
  echo "  $SCRATCH is a separate filesystem: $(df -h "$SCRATCH" | awk 'NR==2{print $4" free"}')"
  echo "  NOTE: ephemeral. Everything here is lost on deallocation."
  SCRATCH_DIR="$SCRATCH/anyrealm"
else
  SCRATCH_DIR="$HOME/.anyrealm/scratch"
  echo "  no separate scratch filesystem (checked /mnt, $SCRATCH)"
  echo "  using $SCRATCH_DIR on the OS disk"
  echo "  NOTE: the OS disk must hold intermediates and artefacts at once, so"
  echo "  clean build output between compositions."
fi
mkdir -p "$SCRATCH_DIR"
printf 'AnyRealm build scratch. Safe to delete when no build is running.\n' \
  > "$SCRATCH_DIR/.anyrealm-scratch"
echo "  scratch  $SCRATCH_DIR"
export ANYREALM_SCRATCH_DIR="$SCRATCH_DIR"
mkdir -p "$HOME/.anyrealm"/{artefacts,firmware,rootfs}
echo "  persistent artefacts: $HOME/.anyrealm/artefacts"

# ---------------------------------------------------------------------------
# 5. Repositories. The list is a separate file so adding a fork is a one-line
#    edit rather than a script change.
# ---------------------------------------------------------------------------
say "Repositories"
LIST="$(dirname "$(readlink -f "$0")")/vm-repos.list"
if [ ! -f "$LIST" ]; then
  echo "  missing $LIST -- skipping clones" >&2
else
  while read -r url dest branch; do
    case "$url" in ''|\#*) continue ;; esac
    target="$ROOT/$dest"
    if [ -d "$target/.git" ]; then
      echo "  $dest: present ($(git -C "$target" rev-parse --short HEAD))"
    else
      echo "  $dest: cloning"
      # A kernel tree is several GB; its history is needed for patch application
      # and `git describe`, so no shallow clone here.
      if [ -n "${branch:-}" ]; then
        git clone --branch "$branch" "$url" "$target"
      else
        git clone "$url" "$target"
      fi
    fi
  done < "$LIST"
fi

# ---------------------------------------------------------------------------
# 6. Dependencies for the builder itself.
# ---------------------------------------------------------------------------
say "Builder dependencies"
APP="$ROOT/ANYREALM-"
if [ -f "$APP/package.json" ]; then
  ( cd "$APP" && bun install --frozen-lockfile 2>/dev/null || bun install )
  echo "  $(du -sh "$APP/node_modules" 2>/dev/null | cut -f1) installed"
else
  echo "  $APP/package.json not found -- clone may have failed" >&2
fi

# ---------------------------------------------------------------------------
# 7. Prove the server starts. A bootstrapped VM that cannot serve is not
#    bootstrapped, and finding that out now beats finding it out at build time.
# ---------------------------------------------------------------------------
say "Server probe"
if [ -f "$APP/server.ts" ]; then
  ( cd "$APP" && PORT=3000 timeout 25 bun server.ts > /tmp/anyrealm-probe.log 2>&1 & echo $! > /tmp/anyrealm-probe.pid )
  ok=no
  for _ in $(seq 1 30); do
    sleep 1
    if curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then ok=yes; break; fi
  done
  kill "$(cat /tmp/anyrealm-probe.pid)" 2>/dev/null || true
  if [ "$ok" = yes ]; then
    echo "  http://127.0.0.1:3000 answered"
  else
    echo "  did not answer; last lines:" >&2
    tail -15 /tmp/anyrealm-probe.log >&2
  fi
else
  echo "  no server.ts at $APP" >&2
fi

# ---------------------------------------------------------------------------
# 8. Leave the scheduled shutdown alone, but show it. Losing the credit window
#    because a timer was silently replaced is the expensive mistake here.
# ---------------------------------------------------------------------------
say "Scheduled shutdown (informational; not modified)"
if have systemctl && systemctl is-enabled --quiet shutdown.target 2>/dev/null; then
  echo "  shutdown.target is enabled"
fi
if [ -f /run/systemd/shutdown/scheduled ]; then
  cat /run/systemd/shutdown/scheduled
else
  echo "  no shutdown currently scheduled, per /run/systemd/shutdown/scheduled"
  echo "  To restore the 2026-12-10 23:25 UTC stop:"
  echo "    sudo shutdown -P '2026-12-10 23:25'"
fi

say "Done"
cat <<'EOF'
Next, in order:

  1. Upload firmware and images to the VM, then unpack them there:
       rsync -avP ./firmware/ slm015@HOST:~/.anyrealm/firmware/
     The builder reads them from disk instead of re-downloading an AOSP tree.

  2. Serve the builder for remote access:
       cd ~/ANYREALM- && PORT=3000 bun server.ts
     Port 3000 is already open on this VM.

  3. Keep intermediates off the artefact path:
       export ANYREALM_SCRATCH_DIR=${ANYREALM_SCRATCH_DIR:-$HOME/.anyrealm/scratch}
EOF
