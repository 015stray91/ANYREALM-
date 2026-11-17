#!/usr/bin/env bash
# Push local toolchains to the build VM.
#
# Run this ON YOUR OWN MACHINE, not on the VM or in the workspace.  The VM can
# only reach what you send it; nothing in the workspace can see your local disk.
#
#   ./send-toolchains.sh /path/to/tigress
#   ./send-toolchains.sh /path/to/tigress /path/to/ollvm-build /path/to/hellscape.so
#
# Each argument is a file or directory and lands under ~/toolchains/<name>,
# where <name> is the basename.  So passing /opt/llvm-obf/tigress gives you
# ~/toolchains/tigress on the VM.
#
# Why a script rather than scp: these trees carry symlinks and permission bits
# that matter (Tigress' Cilly and machdep plugins are invoked directly), and scp
# flattens neither safely.  rsync -a preserves mode, owner-independent timestamps
# and symlinks.

set -euo pipefail

VM="${VM:-slm015@20.85.217.8}"
KEY="${KEY:-$HOME/.ssh/anyrealm-vm}"
DEST="${DEST:-toolchains}"

if [ $# -eq 0 ]; then
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
fi

for src in "$@"; do
    [ -e "$src" ] || { echo "not found: $src" >&2; exit 1; }
done

# Preflight: the transfer is useless if the destination or the key is wrong, and
# discovering that after sending 2 GB wastes the whole trip.
echo "checking $VM ..."
ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 "$VM" \
    "mkdir -p ~/$DEST && df -h ~/$DEST | tail -1"

for src in "$@"; do
    name="$(basename "${src%/}")"
    echo
    echo "=== $src -> ~/$DEST/$name"
    # --info=progress2 gives one aggregate bar instead of a line per file, which
    # matters for a tree like Tigress with thousands of small files.
    rsync -a --info=progress2 --human-readable \
          -e "ssh -i $KEY -o IdentitiesOnly=yes" \
          "${src%/}" "$VM:~/$DEST/$name"
done

echo
echo "=== verifying on the VM"
for src in "$@"; do
    name="$(basename "${src%/}")"
    ssh -i "$KEY" -o IdentitiesOnly=yes "$VM" \
        "du -sh ~/$DEST/$name; find ~/$DEST/$name -maxdepth 2 -type f | head -3"
done

echo
echo "done. the files are under ~/$DEST on $VM"
