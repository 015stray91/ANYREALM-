#!/usr/bin/env bash
#
# One command to bring the VM copy level with GitHub and prove it still builds.
#
# The two copies drift because syncing is a sequence someone has to remember:
# pull, then install if the lockfile moved, then typecheck, then build. Do it by
# hand and one step gets skipped, usually the last one, which is the only step
# that says whether anything still works.
#
# This does the whole sequence and refuses to report success unless the build
# actually produced its output files.
#
set -euo pipefail

REPO="${REPO:-/home/slm015/anyrealm-workspace/anyrealm-builder}"
BRANCH="${BRANCH:-main}"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

[ -d "$REPO/.git" ] || fail "not a git repo: $REPO"
cd "$REPO"

before=$(git rev-parse --short HEAD)

say "fetching origin"
git fetch -q origin || fail "fetch failed -- check network or credentials"

say "fast-forward to origin/$BRANCH"
# --ff-only on purpose: if this ever needs a merge, the histories have split and
# that is the thing to look at, not something to paper over.
git merge --ff-only "origin/$BRANCH" 2>&1 | tail -5 || fail "cannot fast-forward; histories have diverged"

after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ]; then
  say "already level at $after"
else
  say "moved $before -> $after"
fi

# Dependencies only when the lockfile changed relative to the tree that built.
#
# npm ci, not npm install. The two machines run different npm majors (10 here,
# 11 in the workspace), and npm 10 rewrites package-lock.json on install --
# dropping the "libc" fields npm 11 writes. That single field made the VM dirty
# after every sync, which is exactly how a build target starts drifting.
#
# npm ci installs strictly from the lockfile and never writes to it, so a clean
# tree stays clean no matter which npm runs it.
say "checking dependencies"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  rm -rf node_modules
  npm ci --no-audit --no-fund 2>&1 | tail -4 || fail "npm ci failed"
else
  echo "node_modules is newer than the lockfile -- skipping install"
fi

say "typecheck"
npx tsc --noEmit || fail "typecheck failed"

say "build"
npm run build 2>&1 | tail -6 || fail "build failed"

# A build that "succeeds" and leaves nothing behind is the failure mode that has
# bitten this project before, so open the output and count.
say "verify the build wrote its output"
[ -s dist/index.html ] || fail "dist/index.html missing or empty"
[ -s dist/server.cjs ] || fail "dist/server.cjs missing or empty"
printf 'server.cjs  %s\n' "$(du -h dist/server.cjs | cut -f1)"
printf 'assets      %s files\n' "$(find dist/assets -type f 2>/dev/null | wc -l)"

say "tree state"
dirty=$(git status --porcelain | wc -l)
printf 'dirty files: %s\n' "$dirty"
if [ "$dirty" != "0" ]; then
  git status --porcelain
  # A build target that gains local edits is the drift this script exists to
  # prevent, so treat it as a failure rather than a note.
  fail "the synced tree is dirty -- something wrote to tracked files"
fi

cat <<EOF

------------------------------------------------------------------
VM copy is level with origin/$BRANCH at $after and builds

  repo     $REPO
  served   node dist/server.cjs   (PORT=... to choose a port)
------------------------------------------------------------------
EOF
