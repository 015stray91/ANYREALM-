# What was damaged, and where the good copies live

## The incident

A runaway agent damaged the working tree. It crashed the OS on one install, and
on another it related the tree badly enough that workflows stopped being found.
The `main` branch of `Super-Builders` lost **20 workflows**, including
`build-colonel.yml`, `build-darkmatter-nhpro-iso.yml`, `build-genevn-nuki.yml`,
`nuki-toolchain.yml` and the whole `gki-build*` family. They were not "pruned";
they were collateral damage.

The default branch of `Super-Builders` is **`015stray91`** (the user's own
name), not `main`. That is where the real workflows live. `main` is the damaged
shallow one.

## Recovery: what worked

`recover-deleted.sh` (project root) walks history for the last commit in which a
path still existed and writes that blob out. The subtlety it handles:
`git log -1 -- path` returns the commit that *deleted* the path, so
`git show <that>:path` always fails. The last good version is the newest commit
whose tree still contains the blob.

```sh
recover-deleted.sh origin/015stray91 /tmp/recovered .github/workflows/
```

Result, stated honestly: **7 useful files**, not 14.

The script writes 14, but that count flatters it:

- 3 (`genevn-duck.yml`, `genevn-g.yml`, `Build-zro-genevn`) were never missing —
  they exist on `main`, just not on the default branch, so recovering them from
  history restored nothing.
- 2 came back as 0 bytes.
- 1 (`genevn-vibe.yml`) came back damaged and does not parse.
- **7 are genuinely absent from both `main` and `015stray91` and usable**:
  `gki-build.yml`, `gki-build-wk.yml`, `gki-build-clinical.yml`,
  `kernel-user-git.yml`, `kernel-baseline-test.yml`, `baseline-test.yml`,
  `build.yml`.

Do not describe this as "14 recovered, nothing lost". Files moved is not work
restored, and the difference here is half the total.

Recovered and saved to `~/anyrealm-recovered/workflows/` on the VM:

| file | bytes |
|---|---|
| gki-build.yml | 45495 |
| gki-build-wk.yml | 31033 |
| ak3-core.sh | 34379 |
| gki-build-clinical.yml | 16058 |
| kernel-baseline-test.yml | 14603 |
| kernel-user-git.yml | 13450 |
| Build-zro-genevn.yaml | 9518 |
| baseline-test.yml | 8738 |
| genevn-vibe.yml | 8631 |
| genevn-duck.yml | 6635 |
| build.yml | 2036 |
| genevn-g.yml | 2278 |
| anykernel3.sh | 1383 |

`genevn-vibe.yml` does **not** parse: its `apt-get install` lines lost their
continuation indentation, so line 89 breaks the block mapping. It needs fixing
before it can be restored — the damage is real content damage, not a recovery
artifact.

Two entries came back 0 bytes (`Build-zro-genevn.yml`,
`Genevn-Custom-Toolchain-Build.yml`); the `.yaml`-spelled
`Build-zro-genevn.yaml` recovered intact instead, so use that one.

## Where the good copies actually are

The user has several kernel trees, and they are **the same tree at different
working times** — snapshots, not divergent branches. That is what makes
diff-against-good possible.

Under
`hikari_summer-pluto12_obfuscation-toolchain/AR-platform/NUKI-AR_build/a12-5.10.build/NUKI-AR_genevn/`:

- `gk/AR-NUKi`, `gk/kernel-msm-genevn`, `gk/kernel-msm-genevn (1)`,
  `gk/kernel-msm-genevnk` — four snapshots with `Makefile` + `techpack` +
  (in AR-NUKi) `KernelSU-Next`.
- `AR-NUKI-genevn-main` — full tree with `Makefile` and `techpack`.
- `workflows/` — 55-entry hand-kept archive of workflow files, including
  `.yml`/`.yaml` copies and PDFs of GitHub pages.

**Important:** the `gk/` snapshots carry only `techpack/{.gitignore,Kbuild,stub}`.
The real module sources (`audio camera cvp dataipa datarmnet datarmnet-ext
display eva mmrm video`) are present in the VM's `~/AR-NUKI-genevn/techpack/`,
which has all 11 plus a populated `KernelSU-Next` (15 entries). So **the VM tree
is the most complete one**, and the snapshots are for diffing, not for assembly.

## Where the vendor modules live

`NUKI-stage/vendor/qcom/opensource/` on the laptop holds the Android-side
copies: `vendor-qcom-opensource-{cvp,audio,data,eva,graphics,camera,bt,dsp,mm-sys,
securemsm,spu,synx}-kernel` plus `kernel-modules-wcn`. These are the same
upstream modules as `techpack/` under different Android build paths
(`Android.bp`/`Android.mk`/`Kbuild`/`Makefile` in both).

This resolves the long-standing "17 unresolved external modules" blocker:
**they were never missing.** They are `techpack/` inside the kernel tree, which
is where the kernel's own `Makefile` looks
(`drivers-y := drivers/ sound/ techpack/`). Nothing needs to be fetched or
symlinked from `vendor/`.

## Where the real custom work is: `fs/`

The user's own kernel work lives in `fs/`, not in `techpack/`. Verified in the
VM's `~/AR-NUKI-genevn/fs/`:

| file | bytes | what it is |
|---|---|---|
| `nomount.c` | 178616 | NoMount path redirection subsystem |
| `susfs.c` | 70194 | SUSFS |
| `zeromount.c` | 36147 | ZeroMount |
| `nomount.h` | 13349 | NoMount interface |
| `fs_fuse_anyrealm_fuse.c` | 4846 | AnyRealm FUSE layer |
| `koto/` | 22 entries, 248K | KPM EUD engine, incl. 3 `.patch` files |

It is **fully wired in**, not merely present:

- `fs/Makefile`: `obj-y += koto/`, `obj-y += fs_fuse_anyrealm_fuse.o`,
  `obj-$(CONFIG_KSU_SUSFS) += susfs.o`, `obj-$(CONFIG_NOMOUNT) += nomount.o`,
  `obj-$(CONFIG_ZEROMOUNT) += zeromount.o`.
- `fs/Kconfig`: 14 config entries across `KSU_SUSFS` (incl. the `SUS_PATH` /
  `SUS_MOUNT` sub-options), `ZEROMOUNT`, `NOMOUNT`, `KPM`.
- `fs/xattr.c` carries a real integration hunk: under `CONFIG_NOMOUNT`,
  `getxattr` returns `-ENOENT` for an inode hidden from the caller via
  `nm_inode_hidden_from_caller()`. That is the hook that makes redirection
  invisible to callers rather than merely absent.

`Kconfig.orig`, `Makefile.orig` and `xattr.c.orig` are **patch backups, not
damage**. Their diffs confirm the applied work is the intended work (NOMOUNT
config block, KPM/EUD block, the xattr hook). Do not "clean them up" — they are
the only record of what the tree looked like before the custom hunks.

`fs/pnode.c` and `fs/pnode.h` are **upstream kernel files**, not user work; they
appear in `obj-y` because upstream puts them there. Don't mistake them for a
custom addition.

### Safety status

All of it is committed and reachable on GitHub: local `HEAD` `24ec83d3` matches
`refs/heads/main` at `24ec83d3`, and `fs/susfs.c` on the remote returns 70194
bytes — the same size as the working copy. `git status` is clean apart from an
untracked `local-build.config`. The custom files' mtime is 2026-11-17 13:26,
which is a checkout time, not an edit time; the content is from earlier commits.

## What is still actually missing

Absent from **both** `main` and `015stray91`, verified with `git cat-file -e` on
each:

| workflow | recoverable? |
|---|---|
| `gki-build.yml` | yes — 45495 bytes |
| `gki-build-wk.yml` | yes — 31033 bytes |
| `gki-build-clinical.yml` | yes — 16058 bytes |
| `kernel-user-git.yml` | yes — 13450 bytes |
| `kernel-baseline-test.yml` | yes — 14603 bytes |
| `baseline-test.yml` | yes — 8738 bytes |
| `build.yml` | yes — 2036 bytes |
| `genevn-vibe.yml` | **damaged** — content recovered but unparseable |

A sweep of the reachable laptop paths (`home/slm015`, `media/slm015`, the Kubuntu
`Downloads`, `Documents`, `metadata` and the workflow archive) found no other
copy of any of these names. `genevn-vibe.yml` therefore needs repair from the
recovered text, and the others should be restored from
`~/anyrealm-recovered/workflows/`.

## The SATA problem

The user's dock has only **two bays**, so the SSD holding further material has
no connection right now. Treat anything on an unmounted drive as unavailable and
say so rather than guessing at its contents. The clean `kernel-msm-1` clone on
`bb72cd6b-…` was reachable while its drive was in a bay, and its `origin` points
at a local forge (`http://127.0.0.1:3000/slm015/kernel-msm-1.git`) that is not
currently running.

## RAM

The laptop has **4 GB**. A 12 GB zram swap does not fix an arm64 kernel build:
zram keeps compressed pages in RAM, so swapping costs RAM once pages are
incompressible, which compiler IR is. The iGPU also carves its share out of the
same 4 GB. Local builds are not the path; the 31 GB VM is.

`anyrealm-builder/configs/local-build.config` exists for a *marginal* machine —
it drops KASAN/UBSAN/KFENCE/LOCKDEP and uses Thin LTO — but it should not be
presented as making a 4 GB build comfortable. Use `-j4`.

## Colonel CI

`build-colonel.yml` failed every run at exit 100 on
`E: Package 'llvm-17' has no installation candidate` — jammy ships no
llvm-17/clang-17/lld-17, and one missing name fails a whole `apt-get install`.
Those packages are needed only on the plugin compile-from-source fallback: the
prebuilt `Kotoamatsukami.so` is statically linked and `ldd` resolves only
libstdc++/libc/libm/libgcc_s. Fixed on branch `015stray91` (commit `b5feb59`) by
moving them into a `continue-on-error` step that tries the archive then
apt.llvm.org, and by making the fallback report a missing `.so` instead of
handing cmake a nonexistent `LLVM_DIR`.
