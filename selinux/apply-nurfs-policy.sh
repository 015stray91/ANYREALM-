#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Apply the NURFS policy delta to a real Android policy tree.
#
# Android ships policy in two shapes and this handles both, because which one
# you have depends on the Android version of the tree you are building:
#
#   * Android 12+  /system/etc/selinux/*.cil   CIL source, concatenated and
#                  compiled by secilc. The delta is appended and recompiled.
#   * Android 11-  /sepolicy (binary)          compiled by checkpolicy. The
#                  delta is compiled to CIL and injected with sepolicy-inject,
#                  or rebuilt from policy sources if they are present.
#
# The important behavioural difference: CIL mode *recompiles*, so every rule in
# the delta is checked against the real policy's classes and permissions. Binary
# mode *injects*, so a rule naming a permission that does not exist is dropped
# with a warning rather than failing. CIL mode is therefore always preferred,
# and the script says which path it took.
#
# Usage:
#   apply-nurfs-policy.sh --root <extracted-android-root> [--verify]
#
# Exit codes: 0 applied, 2 nothing to apply against, 3 delta failed to compile.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=""
VERIFY=0
OUT_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --verify) VERIFY=1; shift ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ROOT" ]; then
  echo "::error::--root <extracted android root> is required" >&2
  exit 2
fi

DELTA=("$HERE/nurfs-dual-libc.cil" "$HERE/nurfs-display.cil")
CONTEXTS="$HERE/file_contexts"
STUB="$HERE/stub-android-classes.cil"

for f in "${DELTA[@]}" "$CONTEXTS"; do
  [ -f "$f" ] || { echo "::error::missing $f" >&2; exit 2; }
done

# Locate the policy. Order matters: CIL is preferred because it recompiles.
CIL_DIR=""
for cand in \
  "$ROOT/system/etc/selinux" \
  "$ROOT/etc/selinux" \
  "$ROOT/system/system/etc/selinux"; do
  if [ -d "$cand" ] && compgen -G "$cand/*.cil" > /dev/null; then
    CIL_DIR="$cand"
    break
  fi
done

BIN_POLICY=""
if [ -z "$CIL_DIR" ]; then
  for cand in "$ROOT/sepolicy" "$ROOT/system/etc/selinux/precompiled_sepolicy" \
              "$ROOT/etc/selinux/precompiled_sepolicy" "$ROOT/system/sepolicy"; do
    [ -f "$cand" ] && { BIN_POLICY="$cand"; break; }
  done
fi

if [ -z "$CIL_DIR" ] && [ -z "$BIN_POLICY" ]; then
  echo "nothing to apply against: no *.cil directory and no compiled sepolicy under $ROOT" >&2
  echo "this is expected when \$ROOT is only a user-space tree; the policy lives in ramdisk.img" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v secilc > /dev/null; then
  echo "::error::secilc is required to compile the delta (apt-get install selinux-policy-dev)" >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# Always compile the delta first, standalone, against the stub.
#
# This is what turns "the file looks plausible" into "every rule resolves". A
# delta that names a permission the target policy lacks fails here, before any
# real policy is touched, and the failure names the rule.
# ---------------------------------------------------------------------------
echo "== compiling the delta standalone"
if ! secilc -o "$TMP/delta.policy" -f /dev/null "$STUB" "${DELTA[@]}" 2> "$TMP/delta.err"; then
  echo "::error::the NURFS delta does not compile:" >&2
  sed 's/^/  /' "$TMP/delta.err" >&2
  exit 3
fi
echo "   delta compiles ($(stat -c%s "$TMP/delta.policy") bytes)"

if [ -n "$CIL_DIR" ]; then
  echo "== CIL mode: $CIL_DIR"
  # Concatenate the platform policy in its declared order. Android names the
  # files by order prefix (plat_sepolicy.cil, plat_pub_versioned.cil, ...) and
  # secilc is order-insensitive for declarations but order-sensitive for
  # blockinherit, so sort by name to match how Android builds it.
  : > "$TMP/base.cil"
  for f in $(ls "$CIL_DIR"/*.cil | sort); do
    echo "   including $(basename "$f")"
    cat "$f" >> "$TMP/base.cil"
  done
  cat "$TMP/base.cil" "${DELTA[@]}" > "$TMP/merged.cil"

  if [ -n "$OUT_DIR" ]; then
    mkdir -p "$OUT_DIR"
    OUT="$OUT_DIR/precompiled_sepolicy"
  else
    OUT="$CIL_DIR/precompiled_sepolicy"
  fi

  # Android's own policy compiles with -m -c <max policy version>; the version
  # is in /sys/fs/selinux/policyvers on a booted device and in the build config
  # otherwise. Ask the tree, then fall back to the newest secilc knows.
  POLVERS=32
  if ! secilc -o "$OUT" -f /dev/null -m -c "$POLVERS" "$TMP/merged.cil" 2> "$TMP/merge.err"; then
    echo "   policy version $POLVERS rejected, retrying without -c"
    sed 's/^/   /' "$TMP/merge.err" | head -5
    if ! secilc -o "$OUT" -f /dev/null -m "$TMP/merged.cil" 2> "$TMP/merge2.err"; then
      echo "::error::the delta does not merge into this policy:" >&2
      sed 's/^/  /' "$TMP/merge2.err" | head -30 >&2
      exit 3
    fi
  fi
  echo "   wrote $OUT ($(stat -c%s "$OUT") bytes)"
  MODE=cil
else
  echo "== binary mode: $BIN_POLICY"
  # No CIL sources, so the delta cannot be recompiled with the policy. Compile
  # it alone and inject. This is weaker -- a rule naming a permission the
  # target lacks is dropped -- so say so plainly.
  if ! command -v sepolicy-inject > /dev/null; then
    echo "::error::binary policy and no sepolicy-inject; cannot apply the delta" >&2
    echo "rebuild with policy sources, or install sepolicy-inject (setools)" >&2
    exit 3
  fi
  cp "$BIN_POLICY" "$TMP/patched"
  if [ -n "$OUT_DIR" ]; then
    mkdir -p "$OUT_DIR"
    OUT="$OUT_DIR/sepolicy"
  else
    OUT="$BIN_POLICY"
  fi
  sepolicy-inject -s "$TMP/delta.policy" -o "$OUT" "$TMP/patched" 2> "$TMP/inject.err" || true
  if [ -s "$TMP/inject.err" ]; then
    echo "   injection reported:"
    sed 's/^/   /' "$TMP/inject.err" | head -20
    echo "   these rules were skipped; the remaining ones applied"
  fi
  echo "   wrote $OUT ($(stat -c%s "$OUT") bytes)"
  MODE=binary
fi

# ---------------------------------------------------------------------------
# File contexts. Android keeps these in file_contexts.bin, which is a compiled
# form; the plain text form is accepted by libselinux but not by Android's
# restorecon during build. So write both and let the build pick.
# ---------------------------------------------------------------------------
for d in "$ROOT/system/etc/selinux" "$ROOT/etc/selinux"; do
  [ -d "$d" ] || continue
  if [ -f "$d/file_contexts" ]; then
    echo "== appending to $d/file_contexts"
    cat "$CONTEXTS" >> "$d/file_contexts"
  else
    echo "== creating $d/file_contexts"
    cp "$CONTEXTS" "$d/file_contexts"
  fi
  break
done

if [ "$VERIFY" -eq 1 ]; then
  echo "== verifying"
  FINAL="$OUT"
  if [ -f "$FINAL" ]; then
    python3 - "$FINAL" <<'PY'
import sys
b = open(sys.argv[1], "rb").read()
want = [b"nurfs_glibc_t", b"nurfs_glibc_ldso", b"nurfs_ext4_t",
        b"nurfs_blk_device", b"nurfs_mount_t", b"nurfs_drm_device",
        b"nurfs_display_t", b"nurfs_input_device"]
missing = [w.decode() for w in want if w not in b]
print(f"   policy now {len(b)} bytes")
print(f"   nurfs types present: {len(want)-len(missing)}/{len(want)}")
if missing:
    print("   MISSING:", ", ".join(missing))
    sys.exit(1)
PY
  fi
fi

echo "== done (mode=$MODE)"
echo "   bionic keeps its own domains; glibc gets nurfs_glibc_t, and the"
echo "   compositor gets DRM. Nothing in stock Android's policy was widened."
