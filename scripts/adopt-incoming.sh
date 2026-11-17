#!/usr/bin/env bash
# Inspect what has been dropped into the VM's incoming directory, and optionally
# adopt it as a toolchain.
#
# Run this ON THE VM (or over ssh). It exists because the workspace and your
# machine cannot see each other: a FUSE mount on your laptop is visible only to
# you, and nothing here can connect back to it. The VM is the one place that can
# be reached from both sides, so it is the handover point.
#
#   ./adopt-incoming.sh                 list what is waiting
#   ./adopt-incoming.sh --check <name>  inspect one entry in detail
#   ./adopt-incoming.sh --take <name>   move it to ~/toolchains/<name>
#   ./adopt-incoming.sh --clear         remove everything in incoming
#
# Dropping things there:
#   - from your machine with KIO/sshfs: the VM path is /mnt/anyrealm/incoming
#   - or: rsync -a /path/to/thing slm015@20.85.217.8:/mnt/anyrealm/incoming/

set -euo pipefail

IN="${IN:-/mnt/anyrealm/incoming}"
DEST="${DEST:-$HOME/toolchains}"

shopt -s nullglob

list() {
    local entries=("$IN"/*)
    if [ ${#entries[@]} -eq 0 ]; then
        echo "nothing in $IN"
        echo
        echo "drop a toolchain there from a machine that can reach this VM:"
        echo "  rsync -a /local/path $USER@<vm-ip>:$IN/"
        return 0
    fi
    echo "waiting in $IN:"
    printf '  %-10s %-6s %s\n' SIZE TYPE NAME
    for e in "${entries[@]}"; do
        local size type
        size="$(du -sh "$e" 2>/dev/null | cut -f1)"
        if [ -d "$e" ]; then
            type=dir
        elif [ -L "$e" ]; then
            type=link
        else
            type="$(file -b --mime-type "$e" 2>/dev/null || echo file)"
        fi
        printf '  %-10s %-6s %s\n' "$size" "$type" "$(basename "$e")"
    done
}

check() {
    local name="$1" p="$IN/$1"
    [ -e "$p" ] || { echo "no such entry: $name" >&2; exit 1; }
    echo "=== $name"
    du -sh "$p" 2>/dev/null
    if [ -d "$p" ]; then
        echo "--- top level:"
        ls -la "$p" | head -15
        echo "--- file count: $(find "$p" -type f 2>/dev/null | wc -l)"
        # A toolchain that was copied with a tool that drops permissions is a
        # common failure: every plugin still there, none of them executable, and
        # the build fails much later with a permission error.
        local noexec
        noexec="$(find "$p" -maxdepth 2 -type f ! -perm -u+x 2>/dev/null | wc -l)"
        echo "--- non-executable files in the first two levels: $noexec"
        echo "--- executables: $(find "$p" -type f -perm -u+x 2>/dev/null | wc -l)"
        echo "--- symlinks:    $(find "$p" -type l 2>/dev/null | wc -l)"
        if [ "$(find "$p" -type l 2>/dev/null | wc -l)" -gt 0 ]; then
            echo "--- a symlink to check (they break if the copy flattened them):"
            find "$p" -type l 2>/dev/null | head -3 | while read -r l; do
                printf '    %s -> %s\n' "$l" "$(readlink "$l")"
            done
        fi
    else
        file "$p"
        head -c 64 "$p" | od -c | head -2
    fi
}

take() {
    local name="$1" p="$IN/$1"
    [ -e "$p" ] || { echo "no such entry: $name" >&2; exit 1; }
    mkdir -p "$DEST"
    [ -e "$DEST/$name" ] && { echo "$DEST/$name already exists; remove it first" >&2; exit 1; }
    # mv, not cp: the incoming directory is a handover area, and leaving a second
    # copy behind means the next build might pick up a stale one.
    mv "$p" "$DEST/$name"
    echo "moved to $DEST/$name"
    du -sh "$DEST/$name"
    echo
    echo "the generated workflows link from ~/toolchains/<name>; a catalog entry"
    echo "needs localPath set to toolchains/$name to use it."
}

case "${1:-}" in
    --check) check "${2:?--check needs a name}" ;;
    --take)  take  "${2:?--take needs a name}" ;;
    --clear)
        entries=("$IN"/*)
        [ ${#entries[@]} -eq 0 ] && { echo "already empty"; exit 0; }
        echo "removing ${#entries[@]} entr(ies) from $IN"
        rm -rf "${entries[@]}"
        ;;
    "")      list ;;
    *)       echo "unknown argument: $1" >&2; exit 2 ;;
esac
