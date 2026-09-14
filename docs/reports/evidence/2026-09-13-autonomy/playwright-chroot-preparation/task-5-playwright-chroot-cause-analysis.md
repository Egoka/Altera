# Task 5 Playwright Chromium `chroot` cause analysis

Date: 2026-09-14  
Status: read-only cause analysis; no container, browser, canary, syscall control,
or policy change was run  
Stopped-check state: `playwright canary`, two consecutive failures, remains
stopped; no accepted receipt exists

## Finding

The most specific supported hypothesis is a mismatch between Docker's static
capability filtering of the supplied seccomp JSON and Chromium's namespaced
sandbox sequence:

1. The actual runner used the reviewed user-namespace profile with SHA-256
   `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140`.
   Its `clone`, `setns`, and `unshare` rule is unconditional. Its only `chroot`
   rule is `SCMP_ACT_ALLOW` with
   `includes.caps=["CAP_SYS_CHROOT"]`; otherwise the profile's
   `defaultAction=SCMP_ACT_ERRNO` and `defaultErrnoRet=1` apply.
2. The saved runner inspection records `User="1000:1000"`,
   `CapDrop=["ALL"]`, `CapAdd=null`, `Privileged=false`,
   `SecurityOpt=["no-new-privileges", <the supplied seccomp JSON>]`, and a
   read-only root filesystem.
3. Moby's pinned `moby/profiles/seccomp v0.2.3` loader evaluates an
   `includes.caps` condition against `rs.Process.Capabilities.Bounding`. If a
   required capability is absent, it skips that rule before constructing the
   OCI runtime profile. With `cap-drop=ALL`, the `CAP_SYS_CHROOT`-conditioned
   rule should therefore be omitted, leaving `chroot` to errno 1 (`EPERM`) by
   default.
4. Linux user namespaces deliberately give a process a full capability set
   *inside the new user namespace*, while leaving it unprivileged in the
   parent namespace. Linux permits `chroot(2)` when the caller has
   `CAP_SYS_CHROOT` in its user namespace. Chromium's Linux sandbox source
   calls `sys_chroot("/proc/self/fdinfo/")` to move into a safe empty directory.
   Thus a process can legitimately satisfy the kernel's namespace-scoped
   capability check even though the container-start bounding set used by
   Moby's static profile expansion did not contain `CAP_SYS_CHROOT`.

This explains the exact failure without adding a capability to the container.
It is not yet proved for this run because neither the syscall return/`errno`
nor the daemon-generated OCI seccomp profile/BPF was captured. The saved
`SecurityOpt` contains the submitted extended JSON, not the post-filter OCI
rule list. A path, procfs, LSM, or later Chromium-internal denial is less
consistent with the current evidence but is not excluded until the focused
control below succeeds.

## Direct observations

- `playwright-static/canary-2/control/evidence/canary-report.json` has SHA-256
  `22a160d41e2e3e94dfa3e83cb38cec85c739ad2368452214b03904a295533470`.
  MCP initialization and `tools/list` succeeded. The first browser operation
  launched the exact installed headless shell and then recorded:
  `Check failed: sys_chroot("/proc/self/fdinfo/") == 0`, followed by
  `zygote_host_impl_linux.cc:237`, zygote exit `-1`, and browser `SIGTRAP`.
- The outer Docker canary command exited 1. The report's MCP child shutdown
  field is `exit.code=0`; that is not browser success.
- `main-stderr.log` is an empty file (SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).
  The browser stderr was transported inside the MCP tool error and retained in
  `canary-report.json` and `main-protocol.jsonl`.
- The actual image was
  `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`;
  the installed browser byte hash was
  `f5d89353cc9ef8dc1541268bbee1f05ee40a31ce3d9799b3a274e5147f6a8cdb`.
  The current `scripts/agent-runtime/playwright-seccomp.json` and the canary-2
  snapshot are byte-identical and both have the accepted candidate hash above.
- The earlier user-namespace prerequisite used the accepted base image
  `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a`:
  built-in seccomp made the saved UID-1000 `unshare` control fail with
  `Operation not permitted`; the one-rule candidate made it exit 0. That proves
  the earlier userns filter dependency, not this browser's `chroot` failure.
- Failure history is unchanged: canary 1 failed before MCP launch on root-owned
  mode-0600 browser metadata; canary 2 reached Chromium and failed at
  `sys_chroot`. They are two consecutive failures of the same `playwright
  canary` check, not two repetitions of the same root cause.

## Exact filter semantics

The pinned source chain is Moby Engine commit `56be731` -> vendored
`moby/profiles/seccomp v0.2.3` -> exact default-profile bytes SHA-256
`536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`.
The v0.2.3 loader documents that its JSON extends OCI seccomp with conditional
rules. In `setupSeccomp`, lines 130-141 iterate every `Includes.Caps` value and
`continue Loop` when it is absent from `rs.Process.Capabilities.Bounding`; only
surviving `LinuxSyscall` entries are appended at line 151. This is a launch-time
configuration decision, not a dynamic kernel check of the process's later
user-namespace capabilities.

For this profile the effective alternatives are therefore:

| Submitted `chroot` rule | Container bounding caps | Expected generated rule | Expected filter result |
|---|---|---|---|
| allow, includes `CAP_SYS_CHROOT` | contains `CAP_SYS_CHROOT` | unconditional OCI allow | kernel performs its own permission/path checks |
| allow, includes `CAP_SYS_CHROOT` | empty after `cap-drop=ALL` | rule omitted | profile default returns errno 1 before the kernel operation |

The second row matches the saved container configuration. The expected
generated rule and `EPERM` remain inferred until the control captures the
syscall result. Seccomp cannot safely narrow this syscall by pathname: classic
seccomp BPF receives the syscall number and scalar arguments but cannot
dereference the path pointer.

## Narrow candidate remedy

Prepare a review-only profile derived from the exact current
`ff9cc602...3b7140` bytes with one semantic change: on the unique rule whose
`names` is exactly `["chroot"]`, remove
`includes: {"caps":["CAP_SYS_CHROOT"]}`. The resulting rule is an
unconditional `SCMP_ACT_ALLOW` for `chroot`; every other top-level field,
architecture, rule, action, argument, order, and the existing unconditional
`clone`/`setns`/`unshare` rule must remain identical. Bind its exact bytes and
SHA-256 and emit a structural proof of this sole difference.

This does **not** add `CAP_SYS_CHROOT`, `CAP_SYS_ADMIN`, or any other initial or
host capability. It preserves UID/GID 1000, `cap-drop=ALL`,
`no-new-privileges`, read-only root, the internal isolated network, and
Chromium's `--sandbox`; it adds no `--no-sandbox`, root, privileged, or
unconfined fallback. Passing seccomp permits the kernel to perform its separate
namespace-scoped `CAP_SYS_CHROOT`, path, and LSM checks.

The security delta is real: seccomp cannot express “allow only
`/proc/self/fdinfo/`”, so every process in this tester container that obtains
`CAP_SYS_CHROOT` in its own permitted user namespace can submit `chroot` with
any path visible to it. That does not grant access outside the container's
mounts and does not grant a parent-namespace capability, but it exposes the
`chroot` kernel path and lets such a process alter its own root. The candidate
must remain tester-only and must not be installed as a daemon/global default.

Per the Task 4 final-step rule, source preparation may produce the exact
candidate, static sole-diff proof, and no-network probe program for review.
Applying that expanded profile to any actual container is a security extension
and requires the owner's concrete authorization after those artifacts are
reviewable. This document neither supplies nor requests that authorization.

## Required one-variable cause probe

Prepare one bounded native syscall probe and run two arms only after the above
review and explicit authorization. This is a new cause-control check; it must
not be named as, counted as, or used to reset the stopped browser canary.

### Fixed inputs in both arms

- exact same image ID, platform, runtime, nonroot `1000:1000`, command and
  immutable probe executable SHA-256;
- `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--read-only`, identical
  PID/memory/CPU limits, no network, no auth/config/source mounts, and no model;
- only private read-only probe/policy inputs and a bounded evidence output;
- the same user-namespace setup: create `CLONE_NEWUSER`, establish only the
  caller's one-ID UID/GID mappings (including `setgroups=deny`), synchronize
  parent and child, and prove the child entered a different user namespace;
- before changing root, retain a pre-opened pipe for the result and record the
  relevant namespace inode plus capability fields. Then call raw
  `SYS_chroot` on the literal `/proc/self/fdinfo/` and write `{return, errno}`
  through the existing pipe, so a successful empty-root transition cannot hide
  the result. Do not run a shell or arbitrary command after `chroot`.

The helper must be built once, statically inspected, hashed, and reused
unchanged in both arms. Its parent/child map handshake and result schema need
focused synthetic tests before either container invocation. Capture exact
argv, profile path identity/hash before and after, image identity, container
inspection, stdout/stderr byte counts, result JSON, duration, and teardown.

### Sole variable and decision table

- Arm A: current profile SHA-256 `ff9cc602...3b7140`.
- Arm B: the reviewed exact same profile with only the conditional `chroot`
  include removed.

| Arm A | Arm B | Conclusion / next action |
|---|---|---|
| `-1`, `EPERM` | `0`, errno 0 | Confirms the seccomp capability-gate mismatch. Preserve both records; the stopped browser canary still needs separate explicit recovery authorization. |
| `-1`, `EPERM` | `-1`, `EPERM` | Falsifies the proposed seccomp-only remedy; inspect namespace/capability state and actual OCI/BPF. Do not rerun Chromium. |
| succeeds | any | The submitted profile was not filtered as predicted; capture the actual generated OCI/BPF path before changing policy. |
| any other errno | any other result | Diagnose the named path, procfs, namespace map, LSM, or probe defect; do not infer browser acceptance. |

Even after the first row, a separately authorized browser recovery must rerun
the unchanged meaningful canary under the reviewed tester-only profile and
complete all sandbox, browser interaction, origin, filesystem, no-download,
network-boundary, cleanup, and receipt assertions. The syscall probe alone is
not Playwright or Chromium acceptance.

## Evidence boundary and sources

This analysis read only the saved canary/control evidence, accepted provenance,
current JSON policy, static brief, root rulings, and public primary sources. It
did not run or authorize a third canary, container, browser, or syscall check,
and it did not alter source, index, HEAD, security configuration, daemon state,
or credentials.

- Moby v0.2.3 conditional profile schema and loader:
  <https://raw.githubusercontent.com/moby/profiles/refs/tags/seccomp/v0.2.3/seccomp/seccomp.go>
  and
  <https://raw.githubusercontent.com/moby/profiles/refs/tags/seccomp/v0.2.3/seccomp/seccomp_linux.go>
- Docker seccomp behavior and `SCMP_ACT_ERRNO` default:
  <https://docs.docker.com/engine/security/seccomp/>
- Chromium's current official mirror documents the layered Linux sandbox and
  safe-directory chroot:
  <https://github.com/chromium/chromium/blob/main/sandbox/linux/README.md>
- Chromium source for `ChrootToSelfFdinfo` (supporting source; the actual pinned
  binary error is the binding evidence):
  <https://github.com/chromium/chromium/blob/main/sandbox/linux/services/credentials.cc>
- Linux user-namespace capabilities and `chroot(2)` capability semantics:
  <https://man7.org/linux/man-pages/man7/user_namespaces.7.html> and
  <https://man7.org/linux/man-pages/man2/chroot.2.html>
- Linux seccomp filter limits, including inability to dereference pointer
  arguments:
  <https://docs.kernel.org/userspace-api/seccomp_filter.html>
