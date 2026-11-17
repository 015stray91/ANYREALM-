#!/usr/bin/env bash
# Receive and inventory the large local files a build needs.
#
# Run on the build VM after pushing files up:
#
#   rsync -avP --info=progress2 ./firmware/     slm015@HOST:~/.anyrealm/firmware/
#   rsync -avP --info=progress2 ./DarkMatter*   slm015@HOST:~/.anyrealm/images/
#   ssh slm015@HOST 'bash ~/vm-stage.sh'
#
# This does not unpack anything. It checks that what arrived is complete and
# reports what the builder will find, because a truncated 2 GB rootfs looks like
# a corrupt image three steps later in the build rather than a bad upload.
#
# Firmware is the only source of the vendor half: the builder unpacks it instead
# of re-downloading an AOSP tree. If it is missing or short, that composition
# cannot run at all, so the inventory below is the thing to check before
# dispatching anything.

set -euo pipefail

DATA="${ANYREALM_DATA_DIR:-$HOME/.anyrealm}"
FIRMWARE="$DATA/firmware"
IMAGES="$DATA/images"
ROOTFS="$DATA/rootfs"

say() { printf '\n== %s\n' "$*"; }

say "Layout"
for d in "$FIRMWARE" "$IMAGES" "$ROOTFS" "$DATA/artefacts"; do
  if [ -d "$d" ]; then
    printf '  %-40s %s across %s file(s)\n' "$d" \
      "$(du -sh "$d" | cut -f1)" "$(find "$d" -type f | wc -l)"
  else
    printf '  %-40s (absent)\n' "$d"
  fi
done

say "Firmware"
# Extensions a vendor package or an unpacked boot chain actually arrives as.
if [ -d "$FIRMWARE" ] && [ -n "$(find "$FIRMWARE" -type f -print -quit)" ]; then
  find "$FIRMWARE" -maxdepth 2 -type f -printf '  %-52p %8s bytes\n' | sort
  echo
  echo "  The builder reads these directly; it never re-fetches a vendor tree."
  # A boot image shorter than this is a header without a payload: the upload
  # stopped early. Not fatal for every file, so it warns rather than exits.
  while IFS= read -r f; do
    sz=$(stat -c%s "$f")
    if [ "$sz" -lt 1048576 ]; then
      echo "  NOTE: $(basename "$f") is only ${sz} bytes -- smaller than any real image."
    fi
  done < <(find "$FIRMWARE" -type f \( -name '*.img' -o -name '*.bin' -o -name '*.zip' \))
else
  echo "  nothing uploaded yet"
  echo "  Upload with:"
  echo "    rsync -avP ./firmware/ slm015@HOST:$FIRMWARE/"
fi

say "Images"
if [ -d "$IMAGES" ] && [ -n "$(find "$IMAGES" -type f -print -quit)" ]; then
  find "$IMAGES" -maxdepth 1 -type f -printf '  %-52p %8s bytes\n' | sort
else
  echo "  no ISO uploaded yet; the ISO job composes one from the source catalog"
fi

say "Rootfs"
if [ -d "$ROOTFS" ] && [ -n "$(find "$ROOTFS" -type f -print -quit)" ]; then
  find "$ROOTFS" -maxdepth 1 -type f -printf '  %-52p %8s bytes\n' | sort
  echo
  echo "  Merged into the ISO with rsync --ignore-existing; Kali's copy of any"
  echo "  colliding path is kept under /kali-keep."
else
  echo "  no Kali rootfs uploaded yet"
fi

say "Capacity"
echo "  root fs: $(df -h / | awk 'NR==2{print $4" free of "$2}')"
if mountpoint -q /mnt; then
  echo "  /mnt   : $(df -h /mnt | awk 'NR==2{print $4" free"}') (ephemeral)"
fi
# An ISO build needs headroom for the staged tree, the squashfs, and the final
# image simultaneously: roughly 3x the rootfs size. Warn before it fills the
# disk, because a full disk mid-build leaves a half-written ISO that looks valid.
free_kb=$(df -Pk / | awk 'NR==2{print $4}')
if [ "$free_kb" -lt $((40 * 1024 * 1024)) ]; then
  echo "  WARNING: under 40 GiB free. An ISO build needs room for the staged"
  echo "  tree, the squashfs and the image at once; clean old artefacts first."
fi

say "Done"
echo "  Start the builder with: cd $HOME/ANYREALM- && PORT=3000 bun server.ts"
