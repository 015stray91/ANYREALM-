#!/system/bin/sh
# ---------------------------------------------------------------------------
# Mount the fused NURFS ext4 image without vold.
#
# vold will not do this job. It mounts only what its build-time fstab names, so
# an image that arrived with the build has no mount point at all. This script
# runs from init instead, before vold starts, and so the fuse is in place before
# anything tries to read /usr.
#
# What it does, in order:
#   1. find the image (a block device if the image is a real partition, a file
#      if it shipped inside the system image)
#   2. attach a loop device to it, read-only by default
#   3. mount it at /nurfs
#   4. bind the pieces into place: /usr, /lib64, /etc/ld.so.cache
#
# Read-only is the default on purpose. The fused image is reproducible build
# output; making it writable at boot means a corrupt device persists the
# corruption. --rw exists for development and says so in the log.
# ---------------------------------------------------------------------------
set -eu

TAG="nurfs-mount"
IMG=""
MNT="/nurfs"
MODE="ro"
LOOP=""

# Prefer the kernel log, which is what survives a boot that dies before syslog.
# `2>/dev/null` alone is not enough: the redirection itself can fail when the
# script is run outside init, and that error would print ahead of every line.
log() {
  if [ -w /dev/kmsg ]; then
    echo "$TAG: $*" > /dev/kmsg 2>/dev/null || printf '%s: %s\n' "$TAG" "$*"
  else
    printf '%s: %s\n' "$TAG" "$*"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMG="$2"; shift 2 ;;
    --mount) MNT="$2"; shift 2 ;;
    --rw) MODE="rw"; shift ;;
    --ro) MODE="ro"; shift ;;
    *) log "unknown argument: $1"; exit 2 ;;
  esac
done

# If no image was named, try the documented places. A real partition wins over
# a loop image because it needs no loop device at all.
if [ -z "$IMG" ]; then
  for cand in /dev/block/by-name/nurfs /dev/block/bootdevice/by-name/nurfs \
              /system/etc/nurfs.img /data/nurfs.img; do
    [ -e "$cand" ] && { IMG="$cand"; break; }
  done
fi

if [ -z "$IMG" ]; then
  log "no NURFS image found; the fused user space will not be available"
  log "checked: /dev/block/by-name/nurfs /system/etc/nurfs.img /data/nurfs.img"
  # Not an error. A device without a fused image should still boot Android.
  exit 0
fi

log "image: $IMG (mode $MODE)"

mkdir -p "$MNT"

# A regular file needs a loop device; a block device does not.
case "$IMG" in
  /dev/block/*)
    SRC="$IMG"
    ;;
  *)
    if ! LOOP=$(losetup -f 2>/dev/null); then
      log "no free loop device; cannot mount image file $IMG"
      exit 1
    fi
    log "attaching $IMG to $LOOP ($MODE)"
    if [ "$MODE" = "ro" ]; then
      losetup -r "$LOOP" "$IMG"
    else
      losetup "$LOOP" "$IMG"
    fi
    SRC="$LOOP"
    ;;
esac

# -t ext4 explicitly: mount(8) would otherwise probe, and on some vendor kernels
# the probe order reaches an unsupported fstype and fails before trying ext4.
if ! mount -t ext4 -o "$MODE,nodev,nosuid" "$SRC" "$MNT"; then
  log "mount failed for $SRC"
  [ -n "$LOOP" ] && losetup -d "$LOOP" 2>/dev/null || true
  exit 1
fi
log "mounted $SRC at $MNT"

# The fuse. Android has no /usr, so binding one in collides with nothing; on a
# tree that already has /usr (a NURFS desktop) the mount point is populated and
# the bind is skipped.
bind_dir() {
  src="$1"; dst="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  if [ -n "$(ls -A "$dst" 2>/dev/null)" ] && [ "$src" != "$dst" ]; then
    # Something already lives here. Do not shadow it silently: the fusion
    # engine already decided ownership, and boot-time is the wrong place to
    # overturn that decision.
    log "$dst is not empty; leaving it alone"
    return 0
  fi
  mount --bind "$src" "$dst" && log "bound $src -> $dst"
}

bind_dir "$MNT/usr" /usr
bind_dir "$MNT/lib64" /lib64
bind_dir "$MNT/lib" /lib
bind_dir "$MNT/opt" /opt
bind_dir "$MNT/etc/alternatives" /etc/alternatives

# ld.so.cache has to be a file, not a directory, so it is bound separately.
if [ -f "$MNT/etc/ld.so.cache" ]; then
  mkdir -p /etc
  touch /etc/ld.so.cache 2>/dev/null || true
  mount --bind "$MNT/etc/ld.so.cache" /etc/ld.so.cache && log "bound ld.so.cache"
fi

# Report what actually landed, so a boot log answers the question without a
# second shell.
for d in /usr /lib64 /nurfs; do
  if [ -d "$d" ]; then
    log "$d: $(ls -A "$d" 2>/dev/null | wc -l) entries"
  fi
done

log "done"
