# Playwright chroot cause-control evidence review

Date: 2026-09-14  
Scope: saved evidence from the authorized two-arm synthetic `chroot` cause control  
Verdict: **PASS — diagnostic cause confirmed within the frozen probe boundary**

## Evidence bindings

- Authorization record SHA-256: `a9f6fecdd15d5cce490b6711300f5290caa38d8ff482b9fe11ce71352ec44cc6`
  - records the user's explicit `chroot` approval, both cause arms authorized, and browser recovery conditional on the two-arm outcome.
- Accepted command manifest SHA-256: `3e61e70d2e0d5d5cac9caa14eb23acc4082087608bfbb14d1232493776740b79`
- Image: `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`
- Probe SHA-256: `64eaccb7266cb476410799090178a76463bd682f3b596d0aa6b2a281abc57b29`
- Control profile SHA-256: `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140`
- Candidate profile SHA-256: `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`
- Control result SHA-256: `9a64f99c0ba0687acd49055a4e2888710446614a682e93239b838e9623c7b4ac`
- Candidate result SHA-256: `0e9463915be166b9e6c5de1d96703593143e4f2c31d006275cd6d64a6bedb1e3`
- Combined cause result SHA-256: `76958ef0c491cbb4b9a9afb83a55b8eedb8a6e5dc8433cec1f69724bbb73f70f`

All fourteen saved command vectors and their fixed environments equal the corresponding accepted-manifest arm vectors. Both Docker inspections serialize exactly one seccomp profile plus `no-new-privileges`; parsing each serialized profile yields the matching frozen control or candidate JSON. Current probe/profile/manifest bytes match their recorded hashes. The frozen runner held the probe and profiles by file descriptor and, after both arms, revalidated descriptor metadata, named inode identity, size, and digest; `cause-result.json` records `inputs_unchanged=true`.

## Actual two-arm result

| Gate | Control | Candidate |
|---|---|---|
| Container ID | `172e37bbc4f1facd7d40ca40d9f5564bb97e71e0cfee3940156ae525e57c0189` | `62161ea092aaefaaebf2a30cf4d16825846cb875449b1399b2fcc536d23dd548` |
| `chroot` return | `-1` | `0` |
| `errno` | `1` (`EPERM`) | `0` |
| user-namespace map | `map_ok=1` | `map_ok=1` |
| child reaped | `1` | `1` |
| cleanup | confirmed | confirmed |

The probe state is otherwise identical between arms:

- parent before and after: UID/GID 1000, all capability sets zero, `NoNewPrivs=1`, seccomp mode 2, namespace inode unchanged;
- child before namespace transition: the same zero capability sets, UID/GID, `NoNewPrivs=1`, and seccomp mode 2;
- child after transition: the same new namespace inode in both arms, UID/GID 1000, `NoNewPrivs=1`, seccomp mode 2, and identical capabilities scoped to the new user namespace;
- `chroot_attempted=1` in both arms.

Each arm completed all seven lifecycle commands with exit code 0, no signal or recorded problem, and empty stderr. Initial and post-run inspections retain the exact image, non-root user, `network=none`, read-only root, `CapDrop=["ALL"]`, no added capabilities, unprivileged mode, `no-new-privileges`, fixed resource limits, fixed read-only probe mount, and no ports or host namespace sharing. Both containers exited 0 without OOM or runtime error, were removed by their exact names, and had empty final-absence output. Control completed in about 0.339 seconds and candidate in about 0.255 seconds, each inside the 15-second bound.

## Claim limit and unknowns

Under the accepted image, probe, namespace transition, capability boundary, and otherwise frozen arm inputs, the control profile rejects `chroot` with `EPERM` while the candidate profile permits the same call. This is direct diagnostic evidence that the profile's conditional `chroot` treatment is the cause of this synthetic failure and that the narrowly expanded candidate removes it without changing the observed outer capability or `no-new-privileges` boundary.

This does **not** establish Chromium sandbox startup, Chromium's complete syscall needs, browser behavior under the candidate profile, or Playwright MCP acceptance. `cause-result.json` records `browser_run=false`; the stopped browser-canary failure count remains **2**. Any browser recovery is a separate authorized step with its own evidence and acceptance gates.

No command, container, syscall, browser, test, authentication, native tool, network, model, Multica, source, index, or HEAD action was performed for this review.
