# The Generic Kernel Claim

*Every claim below has the command that produces it. Run them yourself; that is
the only reason to trust any of it.*

---

## The claim under test

The public story is that Android's Generic Kernel Image (GKI) is a different
class of kernel from the kernel running on ordinary Linux machines. From that
follows a second claim: that the restricted access around Android's boot chain
is a consequence of that difference.

This document tests both. The finding is that the first is false and the second
is a non-sequitur — the restrictions live in signing and verified boot, which are
hardware and policy, not kernel architecture.

---

## 1. The kernel calls itself generic, and so does Ubuntu

Ubuntu labels its kernel **`-generic`**. Not a marketing term — the package name,
in the filename, twelve times in one `/boot`.

```sh
ls /boot | grep -c generic     # 12
```

Inside the config:

```sh
grep CONFIG_LOCALVERSION /boot/config-6.8.0-149-generic
# CONFIG_LOCALVERSION=""
```

The phone kernel sets its own tag:

```sh
grep CONFIG_LOCALVERSION arch/arm64/configs/genevn_defconfig
# CONFIG_LOCALVERSION="-nethunter"
```

So the word "generic" is normal Linux vocabulary for *one kernel serving many
machines*. A single Ubuntu kernel boots on AMD, Intel, ARM, with any GPU, any NIC,
any filesystem. It becomes a particular machine's kernel when it is fused to a
rootfs and booted on that hardware — which is what happens on every boot, on
every Linux install, and always has.

GKI presents that same generic-then-fused lifecycle as a new product category.
The kernel does not support the claim.

**Point:** "generic" is the default condition of a Linux kernel, not a departure.

---

## 2. Multiple kernels coexist on one machine, with no special machinery

One Ubuntu 22.04.5 install, three kernels, all bootable:

```
vmlinuz-5.15.0-203-generic    11,744,776 bytes
vmlinuz-6.8.0-138-generic     15,010,184 bytes
vmlinuz-6.8.0-149-generic     15,063,432 bytes
```

Each with matching `initrd`, `config` and `System.map`. GRUB lists all three:

```sh
grep -c "5.15.0-203" /boot/grub/grub.cfg     # 8
```

`/boot` is an ordinary 2 GB ext4 partition:

```sh
grep ' /boot ' /etc/fstab
# /dev/disk/by-uuid/7f73e12c-… /boot ext4 defaults 0 1
```

A 5.15 kernel and a 6.8 kernel, side by side, either one bootable, no vendor
partition, no symbol whitelist, no ABI freeze. Compare the ABI apparatus GKI
requires for the same job:

```sh
ls android/abi_gki_aarch64_* | grep -v xml | wc -l    # 27 device ABI files
wc -l < android/abi_gki_aarch64.xml.allowed_breaks    # 127 recorded exceptions
```

Twenty-seven contracts and 127 documented breaks, to achieve what a filesystem
with files in it achieves on a laptop.

**Point:** swapping or coexisting kernels is routine on Linux. GKI's machinery is
not required for it.

---

## 3. A major kernel upgrade on a live server, unattended

This very VM, running Ubuntu 24.04.5:

```sh
uname -r                       # 7.0.0-1020-azure
zgrep "install linux-image" /var/log/dpkg.log*
# 2026-11-17 13:18:36 install linux-image-7.0.0-1020-azure:amd64
last -x reboot | head -2
# 7.0.0-1020-azure  Tue Nov 17 13:43
# 7.0.0-1017-azure  Tue Nov 17 12:54 - 13:43
```

A version upgrade performed by `apt`, on a running server, rebooting into the new
kernel 25 minutes later, with nobody deciding anything. No signing ceremony, no
vendor image, no symbol list.

Kernel upgrades on Linux are an `apt` operation. On the phone they are an
unlocked bootloader and a flashed image. **The kernel is the same; the permission
is different.**

**Point:** the difficulty is access control, not kernel engineering.

---

## 4. GKI did not make the kernel modular — it made the *shipping* modular

The claim "GKI is modular where pre-GKI was monolithic" is close to backwards.

The GKI core kernel ships with **zero** loadable modules:

```sh
grep -c "=m$" arch/arm64/configs/gki_defconfig     # 0
```

It is essentially monolithic. Modularity appears when vendor drivers are attached
per device — 93 of them for one target:

```sh
wc -l < modules.list.msm.parrot      # 93
head -3 modules.list.msm.parrot
# gh_virt_wdt.ko
# qcom-pmu-lib.ko
# qcom_wdt_core.ko
```

Those are kernel drivers. A `.ko` is an ELF object with a `vermagic` string, and
`insmod` predates Android by more than a decade. Nothing here is new technology.

What is new is *where the drivers are built and who may change them*:

```sh
grep -n "^drivers-y" Makefile
# 722: drivers-y := drivers/ sound/ techpack/
```

`techpack/` is part of the kernel build. It holds 11 directories and 700 C files —
audio, camera, cvp, dataipa, display, eva, and more:

```sh
ls -d techpack/*/ | wc -l    # 11
find techpack -name "*.c" | wc -l   # 700
```

In a pre-GKI monolithic tree, the same driver code is built in. Under GKI, the
same code is built as modules and loaded from `vendor_dlkm`. Identical source,
different `obj-y` versus `obj-m`, and a longer boot sequence to load them.

**Point:** "not modular" is wrong and unhelpful. The accurate statement is
*shipping* modularised, core unchanged, boot lengthened.

---

## 5. The ramdisk is not separate once the machine is on

The claim is that Android's multi-stage ramdisk makes its boot fundamentally
different. "Separate" describes cold storage only.

On a normal Linux install, GRUB hands over two artefacts together:

```
linux   /vmlinuz-6.8.0-149-generic root=/dev/mapper/ubuntu--vg-… ro
initrd  /initrd.img-6.8.0-149-generic
```

The initrd is a **newc cpio archive** (first six bytes `070701`), not a
filesystem, not a partition:

```sh
head -c 6 /boot/initrd.img-6.8.0-149-generic    # 070701
```

At power-on the firmware loads both into RAM; the kernel unpacks the cpio into its
own `rootfs`, mounts it, and `exec`s `/init`. From that point there is no second
object. The ramdisk's contents *are* the running kernel's filesystem. The
separation existed on disk and ended at `exec`.

Android's `boot` + `vendor_boot` split does the same thing with two partitions
instead of two files. Both stages land in the same RAM and contribute to the same
rootfs before `init` runs. **Two partitions in cold storage, one rootfs when
live.** The split lengthened the boot sequence; it did not create two runtimes.

**Point:** the boot sequence is the same shape everywhere. GKI's version is
longer, and the length pays for the signature check.

---

## 6. The kernel is not the lock — the boot chain is

If GKI's restriction came from the kernel, a more locked-down kernel would be a
more restricted machine. The opposite is true here.

| config | Ubuntu 6.8 | genevn 5.10 |
|---|---|---|
| `CONFIG_SECURITY_LOCKDOWN_LSM` | **=y** | not set |
| `CONFIG_MODULE_SIG` | **=y** | not set |
| `CONFIG_IMA` | **=y** | not set |
| `CONFIG_DM_VERITY` | `=m` | `=y` |
| `CONFIG_SECURITY_SELINUX` | `=y` | `=y` |

```sh
grep -E "^CONFIG_(SECURITY_LOCKDOWN_LSM|MODULE_SIG|IMA|DM_VERITY)=" \
     /boot/config-6.8.0-149-generic
grep -E "^CONFIG_(SECURITY_LOCKDOWN_LSM|MODULE_SIG|IMA|DM_VERITY)=" nuki-colonel.config
```

Ubuntu compiles in lockdown, module signature verification and IMA. The phone
kernel does not even enable them. `DM_VERITY` is a *module* on Ubuntu — present
only if loaded. The laptop has more kernel-level enforcement compiled in, and the
owner replaces the kernel freely.

The restriction is elsewhere, and none of it is a kernel feature:

1. **The boot key in hardware fuses** — a hash burned once, verifying the boot
   image, unchangeable. The laptop's `BOOTX64.EFI` is an ordinary replaceable file.
2. **`vbmeta` / dm-verity over the system image** — one changed byte refuses to
   mount. The base `system.img` is ext4 with `has_journal`, which is the artefact
   that chain wants to verify.
3. **SELinux enforcing** with policy from a signed image you cannot edit.
4. **The bootloader lock itself** — unlocking is a privilege granted by the
   vendor, not held by the owner.

**The decisive distinction:** Ubuntu's lockdown is a switch you can turn off —
`mokutil`, kernel cmdline, your own keys enrolled. The phone's fuse cannot be
turned off. Revocable versus irrevocable. That is the difference, and it is
hardware and licensing, not kernel architecture.

**Point:** GKI is the narrative told about the boot chain, not the mechanism.

---

## What GKI genuinely achieves

Conceding this is what makes the rest credible, and it matters:

- **One kernel patched for many devices.** A single GKI build receives security
  fixes that reach every Android device that adopts it, instead of hundreds of
  vendor kernels going unpatched. For a maintainer responsible for billions of
  handsets, that is a real and serious engineering win.
- **A stable interface for vendor modules.** `abi_gki_aarch64_<oem>` lets a
  vendor update drivers without forking the core.

Both benefits are real. Both accrue to the *maintainer*. Neither requires calling
the result a different kind of kernel, and neither improves the position of a
person who wants to modify hardware they own.

---

## The short version

> Every kernel is generic until it is fused to a rootfs and booted on hardware.
> Ubuntu says so in the filename. GKI's difference is that it is generic to
> Google and not to you — and that difference is a signature in a fuse, not a
> line of kernel code.

---

## What this document does not prove

Stated so the argument stays honest:

- **`techpack/` has not been shown to link.** The sources exist and are wired into
  `drivers-y`; no build in this project has yet demonstrated them compiling into
  a working image. Evidence of structure, not of a successful build.
- **The published ISO predates the loader fix.** The 12.6 GB `dark-hunter.iso`
  was built before the `/lib64/ld-linux-x86-64.so.2` symlink repair, so glibc
  binaries in that artefact cannot start. A rebuild is required before the fusion
  claim can be demonstrated from a downloadable image.
- **No boot log from the target hardware yet.** The fusion is verified in the
  tree, not on the Vivobook.
