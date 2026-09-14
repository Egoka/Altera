# Task 5 Playwright chroot preparation — independent review

Date: 2026-09-14  
Verdict: **NEEDS FIX (one Important lifecycle gap)**  
Scope: static preparation package only; no security expansion, syscall control,
browser-canary recovery, or runtime acceptance is approved here

## Finding

### R1 — Important: runtime-identity preflight is not interruption safe

`commands.json.runtime_identity_preflight` is a single anonymous
`docker run --rm` vector. Unlike both prepared cause-control arms, it has no
fixed container name, no separate create/inspect/start lifecycle, no explicit
outer timeout field, no targeted force-remove vector, no absence check, and no
stdout/stderr targets. `--rm` removes the container after it exits; it does not
provide a stable cleanup identity if the client/coordinator is interrupted
while the container remains running. A hung or interrupted prerequisite can
therefore leave a container that this package cannot deterministically inspect
or remove.

This is a preparation lifecycle defect, not a reason to execute anything now.
Correct only the runtime-identity portion of `commands.json`:

1. Replace the one `docker run --rm` vector with a fixed-name sequence matching
   the arms: pre-absence, `docker create`, `docker inspect`, `docker start
   --attach`, post-run inspect, `docker rm --force`, and post-absence.
2. Keep every existing security/runtime input unchanged: exact image
   `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`,
   `linux/arm64`, UID/GID 1000, built-in seccomp (no profile override),
   `network=none`, read-only root, `cap-drop=ALL`, `no-new-privileges`, no
   mounts, the existing resource limits, and the exact Node built-ins-only
   readback expression.
3. Add a 15-second outer timeout, bounded stdout/stderr targets under a private
   runtime-identity evidence directory, and require trusted-coordinator
   `finally` cleanup on every create-success path, including inspect failure,
   timeout, signal, or malformed output. Both absence checks must be empty.
4. Gate each next command on the previous exit/result, verify the created
   container's exact image/user/security/network/mount/resource settings before
   start, and preserve all raw command/inspect/output/cleanup evidence.
5. Recompute `commands.json` and report hashes in `frozen-hashes.json`; update
   the preparation report to describe the corrected lifecycle. No probe,
   profile, Dockerfile, runtime source, or browser-canary change is needed for
   R1.

Root's scope clarification permits the corrected read-only identity preflight
under unchanged built-in seccomp once this command package is reviewed. It does
not authorize either arm or application of `candidate.json`.

## Static package results

No other correctness or security defect was found in the frozen candidate or
probe.

- Every file named by `frozen-hashes.json` matches its pinned SHA-256. The
  preparation report itself matches
  `42cca2722072327fc532471e665f497e76e05a4c474117383448dcdffe353489`.
- `control.json` matches the accepted profile
  `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140`.
  `candidate.json` matches
  `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`.
  The raw diff contains one deletion only: `/syscalls/23/includes` with value
  `{"caps":["CAP_SYS_CHROOT"]}` from the unique `names:["chroot"]`
  `SCMP_ACT_ALLOW` rule. The profile defaults, syscall order, and all other
  text are unchanged. Both policy files are owner-readable mode 0600.
- `probe.pl` matches
  `64eaccb7266cb476410799090178a76463bd682f3b596d0aa6b2a281abc57b29`.
  Its actual path is fixed to Linux AArch64 Perl, UID/GID 1000, empty initial
  effective/bounding capabilities, `NoNewPrivs=1`, and `Seccomp=2`. It creates
  one child, uses three pre-opened pipes, calls only raw arm64
  `unshare(CLONE_NEWUSER)` and then raw `chroot("/proc/self/fdinfo/")`, and
  never invokes a shell, executable, network operation, dependency, or module.
- The child reports readiness only after successful unshare. The parent writes
  `setgroups=deny` followed by the exact one-ID UID and GID maps; any write
  failure sends refusal and prevents chroot. The child verifies a changed user
  namespace, UID/GID 1000, and effective `CAP_SYS_CHROOT` before the call.
- Return and numeric errno are captured immediately. The bounded JSON result is
  written through the pipe retained across chroot; the parent drains to EOF,
  waits for the exact child, retains its own before/after namespace snapshots,
  and uses a five-second alarm. Error recovery kills and waits only for that
  known child. Error text and environment contents are not emitted.
- Both cause-control arm vectors use fixed names, exact image/profile/probe
  pins, `network=none`, read-only root, UID/GID 1000, `cap-drop=ALL`,
  `no-new-privileges`, PID/memory/CPU bounds, and one read-only probe mount.
  Profile JSON is a daemon input and is not mounted. The vectors include
  create/inspect/start/remove/absence and a 15-second outer-timeout field.
  Their later executor must enforce those fields and use `finally` cleanup;
  the JSON is intentionally not an executor.
- Preserved evidence says both Perl syntax records passed and the synthetic
  callback suite passed 4/4. The suite covers success/errno separation,
  unshare and mapping refusal before chroot, stopped mapping writes, targeted
  cleanup, literal syscall/path pins, and absence of executor/module patterns.
  This review did not rerun it.

The helper is deliberately a syscall discriminator, not a complete Chromium
sandbox reproduction. In particular, ordinary `fork` does not recreate
Chromium's shared-filesystem helper flags; that does not weaken the intended
one-variable test because the seccomp `chroot` rule has no argument or clone
state condition. Browser behavior remains a separate acceptance check.

## Runtime and behavior unknowns retained

- The exact image has not yet proved that `/usr/bin/perl` exists, resolves to
  the expected canonical regular executable, is Linux ELF64 little-endian
  AArch64, or has a particular digest. R1 must be fixed before the already
  authorized built-in-seccomp identity preflight gathers that evidence. If the
  identity is absent or incompatible, stop without substitution or install.
- No actual process has proved Perl's raw-syscall ABI, `fork`, user-namespace
  creation, parent map writes, procfs reads, namespace-scoped capability,
  child-pipe draining, watchdog cleanup, or returned errno in the pinned image
  on this Docker/kernel/runtime stack.
- No actual inspection has proved the applied per-container seccomp profile or
  all security/resource settings for either arm. Before any future authorized
  arm, the trusted coordinator must bind the exact policy/probe path identity,
  restrictive metadata and hash before/after; use private bounded evidence
  outputs; verify the created container; and prove final absence.
- `candidate.json` has not been applied. Its unconditional `chroot` allow is a
  real, path-agnostic tester-container security extension. Owner approval is
  still required after the corrected package and runtime-identity evidence are
  concrete.
- The stopped `playwright canary` remains at two consecutive failures. A
  syscall cause-control result would neither reset that count nor establish
  Chromium sandbox, MCP, origin, filesystem, network, cleanup, or receipt
  acceptance. Canary recovery remains separately unauthorized.

## Review method and boundary

Trace was attempted first after `get_project_map(summary_only=true)`. The
execution scratch files were absent from the 290-file project index; symbol
search returned no matches and `get_outline` could not resolve them. Review
therefore used the permitted exact frozen-file fallback. It read the report,
manifest, JSON/config, source and preserved logs, recomputed every manifest
hash, and inspected the one textual profile diff. It did not rerun the saved
suite or syntax check and did not invoke Docker, a container, fork/unshare,
`chroot`, browser, auth, model, native CLI, API, source edit, index, or HEAD.
