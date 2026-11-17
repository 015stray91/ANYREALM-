#!/usr/bin/env bash
# Mount the build VM's toolchain directory over sshfs, so toolchains can be
# dragged in with a file manager instead of pushed with rsync.
#
# Run this ON YOUR OWN MACHINE.  Needs sshfs once:
#   Ubuntu/Debian:  sudo apt install -y sshfs
#   Fedora:         sudo dnf install -y fuse-sshfs
#   macOS:          brew install --cask macfuse && brew install gromgit/fuse/sshfs-mac
#
#   ./mount-vm.sh            mount at ~/mnt/anyrealm-vm
#   ./mount-vm.sh --open     mount, then open it in the file manager
#   ./mount-vm.sh --umount   unmount
#
# Then copy a toolchain in with the file manager, or:
#   cp -a /path/to/tigress ~/mnt/anyrealm-vm/toolchains/
#
# The mount point is the VM's home, so ~/toolchains is one level in -- the same
# path the generated workflows link from.

set -euo pipefail

VM="${VM:-slm015@20.85.217.8}"
KEY="${KEY:-$HOME/.ssh/id_ed25519}"
MNT="${MNT:-$HOME/mnt/anyrealm-vm}"

umount_it() {
    if mountpoint -q "$MNT" 2>/dev/null; then
        # -u rather than a plain umount: a file manager holding a handle on the
        # mount is the normal case here, and a busy unmount is not worth an error.
        if command -v fusermount3 >/dev/null; then
            fusermount3 -u "$MNT" 2>/dev/null || fusermount3 -uz "$MNT" || true
        elif command -v fusermount >/dev/null; then
            fusermount -u "$MNT" 2>/dev/null || fusermount -uz "$MNT" || true
        else
            umount "$MNT" 2>/dev/null || diskutil unmount "$MNT" 2>/dev/null || true
        fi
        echo "unmounted $MNT"
    else
        echo "$MNT is not mounted"
    fi
}

case "${1:-}" in
    --umount|--unmount) umount_it; exit 0 ;;
esac

command -v sshfs >/dev/null \
    || { echo "sshfs is not installed. See the header of this script." >&2; exit 1; }
[ -f "$KEY" ] \
    || { echo "no key at $KEY. Run: ssh-keygen -t ed25519 -N \"\" -f \"$KEY\"" >&2; exit 1; }

# Prove the key is authorised before mounting, so a permission problem is a clear
# message here rather than a confusing empty mount.
if ! ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 \
         "$VM" 'mkdir -p ~/toolchains && echo ok' >/dev/null 2>&1; then
    echo "cannot log in to $VM with $KEY" >&2
    echo "the public half of that key must be in the VM's ~/.ssh/authorized_keys:" >&2
    echo "  $KEY.pub" >&2
    exit 1
fi

mkdir -p "$MNT"

if mountpoint -q "$MNT" 2>/dev/null; then
    echo "already mounted at $MNT"
else
    # -o reconnect      survives a network blip instead of wedging the mount
    # -o ServerAliveInterval  keeps NAT mappings from expiring mid-copy
    # -o idmap=user     so files show as you, not as nobody
    # -o cache=yes      a toolchain is thousands of small files; without the
    #                   cache a recursive copy is glacial over ssh
    # -o compression=no large archives are already compressed, so this only costs
    #                   CPU. Flip it on for source trees if you prefer.
    sshfs "$VM:" "$MNT" \
        -o "IdentityFile=$KEY" \
        -o IdentitiesOnly=yes \
        -o reconnect \
        -o ServerAliveInterval=15 \
        -o ServerAliveCountMax=3 \
        -o idmap=user \
        -o cache=yes \
        -o kernel_cache \
        -o compression=no \
        -o auto_unmount
    echo "mounted $VM: at $MNT"
fi

echo
echo "toolchains go in:  $MNT/toolchains"
ls "$MNT/toolchains" 2>/dev/null | head -10 || true

# A copy over sshfs is a network round trip per file, which is fine for a few
# large ones and slow for a tree of thousands. Say which one is happening rather
# than leaving the user to wonder why it is crawling.
cat <<'NOTE'

Copying a tree with thousands of small files over sshfs is slow, because each
file is a round trip. For a big tree, rsync is much faster:

  rsync -a --info=progress2 /path/to/toolchain slm015@20.85.217.8:toolchains/

Use the mount for a few large files or for browsing; use rsync for a whole
toolchain. Both write to the same place.
NOTE

if [ "${1:-}" = "--open" ]; then
    (xdg-open "$MNT" 2>/dev/null || open "$MNT" 2>/dev/null || true) &
fi
