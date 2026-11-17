#!/usr/bin/env bash
# Attach this project to the remote build VM in one step.
#
# Run from the project root on the machine that holds the private key:
#
#   scripts/vm-attach.sh ~/azure_key
#   scripts/vm-attach.sh ~/azure_key 20.85.217.8 slm015
#
# It installs the key with the permissions ssh demands, checks the host really is
# the box we expect before changing anything on it, copies the provisioning
# scripts across, and runs the bootstrap. The bootstrap is idempotent, so running
# this twice is harmless -- the second run reports what is already present.
#
# The key is copied into ~/.ssh on this machine because ssh refuses a key that
# anything but its owner can read, and it keeps the original untouched so a
# mistake here cannot destroy your only copy.

set -euo pipefail

KEY_SRC="${1:?usage: vm-attach.sh <private-key-path> [host] [user]}"
HOST="${2:-20.85.217.8}"
USER_NAME="${3:-slm015}"

cd "$(dirname "$(readlink -f "$0")")/.."

if [ ! -f "$KEY_SRC" ]; then
  echo "no such key: $KEY_SRC" >&2
  exit 1
fi

# Reject the placeholder before ssh does, because "Permission denied" would send
# you looking for a network problem when the key simply was never pasted in.
if grep -qE '^\s*\[PASTE' "$KEY_SRC"; then
  echo "that file still contains the paste placeholder, not a key" >&2
  exit 1
fi
if ! grep -qE 'BEGIN (OPENSSH|RSA|EC|PRIVATE) PRIVATE KEY' "$KEY_SRC"; then
  echo "$KEY_SRC does not look like a private key (no BEGIN ... PRIVATE KEY line)" >&2
  exit 1
fi

mkdir -p "$HOME/.ssh"
KEY="$HOME/.ssh/anyrealm-vm"
# strip CR so a key pasted through a Windows editor still works
tr -d '\r' < "$KEY_SRC" > "$KEY"
chmod 600 "$KEY"

SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
     -o ConnectTimeout=15 "$USER_NAME@$HOST")

echo "== checking access"
if ! out=$("${SSH[@]}" 'echo ok' 2>&1); then
  echo "could not reach $USER_NAME@$HOST:" >&2
  echo "$out" >&2
  exit 1
fi

echo "== host identity"
"${SSH[@]}" 'printf "  hostname %s\n  kernel   %s\n  arch     %s\n  cpus     %s\n  memory   %s\n  root     %s\n" \
  "$(hostname)" "$(uname -r)" "$(uname -m)" "$(nproc)" \
  "$(awk "/MemTotal/{printf \"%.1f GiB\", \$2/1048576}" /proc/meminfo)" \
  "$(df -h / | awk "NR==2{print \$4\" free of \"\$2}")"'

echo "== copying provisioning scripts"
scp -q -i "$KEY" -o IdentitiesOnly=yes \
  scripts/vm-bootstrap.sh scripts/vm-repos.list scripts/vm-stage.sh \
  "$USER_NAME@$HOST:~/"

echo "== running bootstrap (this installs packages and clones repos; it can take several minutes)"
"${SSH[@]}" 'bash ~/vm-bootstrap.sh' 2>&1 | sed 's/^/  /'

echo
echo "== attached"
echo "  Serve from the VM:   ssh -i $KEY $USER_NAME@$HOST 'cd ~/ANYREALM- && PORT=3000 bun server.ts'"
echo "  Forward it locally:  ssh -N -i $KEY -L 3000:127.0.0.1:3000 $USER_NAME@$HOST"
