# Note to the agent: read this before claiming anything works

Written 2026-11-20, after a session where I asserted several things that were
wrong. Each entry below cost real time or produced a false claim. They are here
so the next run does not pay for them again.

The one-line version: **open the artifact, don't read the green tick.**

---

## The rule that would have prevented most of this

`|| true`, `2>/dev/null`, and a conditional wrapper around a command turn
failures into silent successes. Three "successful" builds in this project
produced unusable artifacts because of exactly that. The check is not "did the
command exit 0", it is:

- unpack the `.deb` (`dpkg-deb -c`) and count the files you expected
- extract the AppImage (`--appimage-extract`) and count
- read the response body, not just the HTTP status
- `git ls-tree` the commit the build actually checked out

## Machine facts that were wrong in my head

- **Builds reach the Azure box through its self-hosted GitHub runners**
  (`anyrealm-vm`, `anyrealm-vm-2`), not over plain ssh. The first app and APK
  were built from `/home/slm015/_work/ANYREALM-/ANYREALM-`. I got this wrong
  repeatedly.
- **Azure is both the model box and the engine box.** It is not two machines and
  not the AWS machine. There is no AWS instance. `aws` CLI on both boxes is
  installed and **not signed in**.
- `ANDROID_HOME` lives in the **runner systemd service**, not a shell profile.
  So it exists for a workflow and not for an interactive login. That is
  correct and intentional.

## Packaging defects found and fixed (all were invisible until inspected)

1. **The deb and AppImage shipped zero plugins.** electron-builder's `files`
   list named `dist/`, the catalogs and `package.json`; `plugins/` was absent.
   Plugins are `.mjs` read from disk at runtime, so they cannot be bundled into
   `server.cjs` — they must be copied in as-is (`plugins/**/*`).
2. **`here()` read `globalThis.__dirname`.** In a CJS bundle `__dirname` is
   module-scoped, so off `globalThis` it is always `undefined` and every path
   fell back to `process.cwd()`. The Electron launcher's `ANYREALM_DATA_DIR`
   masked it. Running the packaged server directly mounted `0/0 addons` from
   `/tmp/plugins`. Reference `__dirname` directly; `typeof` on an unbound
   identifier is safe, so ESM dev still works.
3. **`@xterm/addon-fit` was in `package.json` but not `bun.lock`.** Two desktop
   builds died in 7 s and 11 s on `bun install --frozen-lockfile`. I nearly
   blamed the VM. `vite` was also declared in both `dependencies` and
   `devDependencies`.
4. `terminal-lab/server.mjs` imports `../ai-engine/engine.mjs` by relative path.
   Those two directories must ship together or the terminal fails to load — a
   missing-plugin bug here does not look like an empty tab, it looks like a
   broken terminal.

## The repo

- The local repo is a **shallow clone**. `git fsck` reporting "broken link" was
  the shallow boundary, not corruption. Check
  `git rev-parse --is-shallow-repository` before declaring damage.
- Repaired by cloning fresh and installing the verified `.git`. Rebuilding the
  index needs `git reset --mixed HEAD`, and the bare clone's config loses
  `core.bare`, `core.worktree`, `branch.main.remote/merge` and the commit
  identity — those must be restored or commits fail with "Author identity
  unknown".
- **The VM clone is a build target, not an author.** `scripts/vm-guard.sh`
  installs a pre-commit hook that refuses commits there and proves the refusal.
  `scripts/vm-sync.sh` fetches, `--ff-only` merges, `npm ci`, typechecks,
  builds, then opens `dist/` and counts.
- Use `npm ci` on the VM, never `npm install`: it runs npm 10 and this workspace
  npm 11, and npm 10 rewrites `package-lock.json` (drops `libc` fields), which
  dirtied the tree on every sync.

## Long-lived constraints

- The Azure box **stays up until Dec 10, 6pm Central**. Do not reboot it to
  prove the llama unit's boot behaviour. Enabled and restart-on-crash are
  verified; **reboot is not**, and say so.
- The model server binds `127.0.0.1:8090` only. The app reaches it through an
  ssh tunnel on 18090. Never bind it to `0.0.0.0` — that is an open inference
  endpoint on the public internet.
- Build output lives on the VM (94 GB free) and not in this workspace (3 GB).
  The workspace is for editing and the preview.

## Claims I made that were false

- "Someone typed it" about the model server — it was a script I ran. Say "I
  started it; nothing was restarting it."
- "A build and the model can share the 4 cores comfortably" — a kernel build
  saturates all four and generation crawls.
- "The AWS box is reachable" — it was deleted.
- Treating a plugin's `healthy: true` as evidence, without reading a body. Vite's
  SPA fallback returns 200 with HTML for routes that do not exist.

## How to check my own work before reporting

```
cd anyrealm-builder
npx tsc --noEmit                     # must be 0
npm run build                        # then check dist/server.cjs and dist/assets
git status --porcelain               # must be empty
git fsck --no-progress               # 0 broken links
```

For a packaged build, these are the three that matter:

```
dpkg-deb -c <deb> | grep -oE "resources/app/plugins/[^ ]*"   # plugins present
# extract the deb, then run the server from an unrelated cwd with no env help:
cd /tmp && PORT=3499 NODE_ENV=production node "<app>/dist/server.cjs"
# expect: [plugins] N/N addon(s) mounted from <the app>/plugins
curl -s localhost:3499/api/plugins                            # ids + healthy
```

Quoting traps that wasted time: paths under `/opt/AnyRealm Builder` contain a
space, so `awk '{print $6}'` truncates them — use `grep -oE`. Heredocs with
quotes break over ssh; write locally and `scp`. Backticks in a `-m` message get
executed by the shell; use `git commit -F file`.
