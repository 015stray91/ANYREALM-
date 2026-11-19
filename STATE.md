# AnyRealm — where everything is (checked 2026-11-19 23:45 UTC)

This file is the answer to "where does anything live". Every line here was
verified by running something, not remembered. When a fact changes, change the
line — a stale note is worse than no note.

## The three machines

| | what | address | state |
|---|---|---|---|
| **Azure VM** | model server **and** build engine | `ssh -i ~/.ssh/anyrealm-vm slm015@20.85.217.8` | up, 4 cores, 31 GB, 99 GB free on `/`, 82 GB on `/mnt` |
| **AWS** | engine that you deleted | — | **nothing exists.** No instance, no key, no cost |
| **this workspace** | editing + the app's preview | `/home/ubuntu/project` | 16 GB disk, 3.0 GB free |

The Azure box is both roles. It is **not** two machines, and it is not the AWS
box. It stays up until the shutdown timer fires.

### Shutdown deadline — 6pm Central, verified

`anyrealm-shutdown.timer` is overridden by
`/etc/systemd/system/anyrealm-shutdown.timer.d/50-timezone.conf`:

```
OnCalendar=
OnCalendar=2026-12-10 18:00:00 America/Chicago
```

The empty `OnCalendar=` is required. A drop-in that only adds a line leaves the
base unit's value in place as well, and the earlier one wins.

Verified: `NextElapse = Fri 2026-12-11 00:00:00 UTC` = `Thu Dec 10 06:00 PM CST`.

**Do not reboot the Azure box to prove the llama unit's boot behaviour.** Enabled
and restart-on-crash are verified. Reboot is not, and waits until after Dec 10.

## Model serving on Azure

`llama-server.service`, `Restart=always`, **binds 127.0.0.1:8090 only** — the app
arrives through an ssh tunnel on 18090, and a public llama-server is an open
inference endpoint.

`StartLimitIntervalSec` / `StartLimitBurst` belong in **`[Unit]`**. systemd drops
them from `[Service]` with one journal line, which it did on my first attempt, so
the restart limit was not in force. Check with:

```
systemctl show llama-server -p StartLimitBurst -p Restart
```

Model: `/mnt/anyrealm/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf` (4.4 GB)
llama.cpp: `/mnt/anyrealm/llama/llama-b12553`
whisper: `/mnt/anyrealm/whisper/whisper-bin-ubuntu-x64/whisper-cli`
speech model: `/mnt/anyrealm/models/ggml-base.en.bin`

Verified through the tunnel: `/health` 200 and a real completion returned.

## Builds go through the self-hosted runner, not plain ssh

Two runners are registered to `015stray91/ANYREALM-`, both on the Azure box:

| runner | work folder |
|---|---|
| `anyrealm-vm` | `/home/slm015/_work` |
| `anyrealm-vm-2` | `/home/slm015/_work2` |

Both services `active`. The first app and APK were built from
`/home/slm015/_work/ANYREALM-/ANYREALM-`.

This is the correction that mattered: builds do not arrive by `ssh`, they arrive
by the runner picking up a workflow. `.github/workflows/build-apk.yml` runs
`runs-on: [self-hosted, anyrealm-vm]`.

Android toolchain, verified present:

- `ANDROID_HOME=/home/slm015/android-sdk`, exported **in the runner service**,
  not in a shell profile — so it exists for a workflow and not only for a login
- platforms: `android-37.0` · build-tools: `36.0.0` · JDK 21

## Workspace copy on Azure — the durable home

`/home/slm015/anyrealm-workspace` — the whole workspace, 7.1 MB, git history
intact, tree clean at commit `7bf8ca3`. Excludes `node_modules`, `dist`.

Node 22.23.5 / npm are installed there (`/usr/bin/node`). Bun 1.4.4 is also
present, but the project's own scripts shell out to `npm run`, so Node is the
toolchain that matters.

Done there: `npm ci`, typecheck, build, and a full desktop build through the
runner. This copy is where history, docs and build output live; the local one is
for editing only, which is why it can stay small.

## AWS CLI

Installed on **both** this workspace and the Azure box: `aws-cli/2.41.2`,
profile `anyrealm`, region `us-east-2`. **Neither is signed in.**

`aws login --remote` is waiting in a tmux session named `aws` on the Azure box.
The authorization code is a credential: it goes into that terminal, never into
chat. With no AWS instance left, signing in is optional.

## Things I got wrong, so they are not repeated

- Said "someone typed it" about the model server. It was a script I ran; nothing
  was restarting it. The service is the fix.
- Said the engine and the model could share the Azure cores comfortably. A kernel
  build saturates all 4, so generation crawls during a build.
- Repeatedly assumed the AWS box was reachable. Port 22 was closed, and then the
  box was deleted. The engine slot now points at Azure.
- Trusted "healthy: true" from a plugin without reading a response body. Vite's
  SPA fallback can make any route return 200 with HTML.

## What is actually proven, and what is not

Proven: model answers through the tunnel · service restarts on crash · runner
services active · Android SDK env in the runner · git history clean and pushed ·
APK Studio builds, signs and verifies a real APK (independent `apksigner verify`).

**A full desktop build through the runner — done 2026-11-19, run `44640577263`,
`success`.** Not by reading the green tick: the artifact was downloaded and
opened. Deb `anyrealm-builder_0.1.0_amd64.deb` reports correct package metadata
and 12,416 files; the AppImage extracts to 11,231 files with its binary and
desktop entry. Artifacts kept at
`/home/slm015/_work/ANYREALM-/ANYREALM-/release/` (545 MB + 395 MB).

That run followed two failures in 7 s and 11 s. They were not the machine:
`@xterm/addon-fit` was in `package.json` but missing from `bun.lock`, so
`bun install --frozen-lockfile` refused. Fixed in `99b4539`.

Not proven: llama unit across a reboot · the shipped ISO booting on real hardware
· kiofuse link to the laptop (`/mnt/laptop-room` returns EIO — stale sshfs,
laptop asleep).

## Two copies, one author

The VM clone is a **build target, not a second author**. Editing in both places
is what split the histories and made builds run against trees that were not in
git.

- `scripts/vm-guard.sh` — installs a pre-commit hook on the VM that refuses to
  commit. It proves the refusal by attempting one.
- `scripts/vm-sync.sh` — fetch, `--ff-only` merge, `npm ci`, typecheck, build,
  then open `dist/` and count. Fails if the synced tree is dirty.

`npm ci`, not `npm install`: the VM runs npm 10 and this workspace npm 11, and
npm 10 rewrites `package-lock.json` (drops `libc` fields). Every install dirtied
the tree — the seed of the drift. `npm ci` never writes to the lockfile.

Verified 2026-11-19: VM level with `origin/main`, typecheck exit 0, build exit 0,
`dist/server.cjs` 316 KB, 4 assets, 0 dirty files. 94 GB free on `/` after a
1 GB build — the reason the build output lives there and not here.

## The kiofuse link

`/mnt/laptop-room` on Azure is `fuse.sshfs` from 127.0.0.1. It currently returns
`Input/output error` — the mount is stale. It needs the laptop awake and then a
remount; it is not a config problem.
