#!/usr/bin/env bash
#
# Install the rule that keeps the two copies from drifting:
#
#   the VM never creates history, it only receives it.
#
# Two clones of the same repo diverge for one boring reason: someone (me) edits
# in both places and neither knows about the other. Then a build runs against
# code that is not what is in git, and the answer to "does this work" stops
# meaning anything.
#
# So the VM gets a pre-commit hook that refuses commits and points at the fix.
# A rule that lives in a hook survives a long session; a rule that lives in my
# memory does not.
#
# Run this on the VM. It is idempotent.
#
set -euo pipefail

REPO="${REPO:-/home/slm015/anyrealm-workspace/anyrealm-builder}"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -d "$REPO/.git" ] || fail "not a git repo: $REPO"

say "installing pre-commit guard in $REPO"
mkdir -p "$REPO/.git/hooks"
cat > "$REPO/.git/hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# This clone is a build target, not a source of truth.
#
# Commits made here are invisible to the other copy until someone notices the
# histories split, and by then a build has already run against the wrong tree.
#
# Edit in the workspace, push, then pull here:
#   workspace:  git commit && git push origin main
#   this VM:    git pull --ff-only
cat >&2 <<'MSG'

  refused: this VM does not commit.

  Source of truth is the workspace repo -> GitHub -> here.
  Edit there, push, then on this box:

      git pull --ff-only

  If you genuinely need to commit here, it is:
      git commit --no-verify

MSG
exit 1
HOOK
chmod +x "$REPO/.git/hooks/pre-commit"

say "guard in place"
# Prove it refuses, rather than assuming a hook file means a hook runs.
probe=$(cd "$REPO" && git commit --allow-empty -m "guard probe" 2>&1 || true)
case "$probe" in
  *refused*) echo "verified: a commit here is refused" ;;
  *) fail "the hook did not fire; output was: $probe" ;;
esac

say "state"
cd "$REPO"
git log --oneline -1
printf 'dirty files: %s\n' "$(git status --porcelain | wc -l)"

cat <<'EOF'

------------------------------------------------------------------
the VM now refuses to be a second author

  edit + commit   in the workspace repo
  push            git push origin main
  receive here    git pull --ff-only   (scripts/vm-sync.sh does this)
------------------------------------------------------------------
EOF
