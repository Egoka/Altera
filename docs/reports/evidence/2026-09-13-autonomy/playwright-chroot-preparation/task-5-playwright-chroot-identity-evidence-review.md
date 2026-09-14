# Playwright chroot runtime identity evidence review

Date: 2026-09-14  
Scope: one saved built-in-seccomp runtime identity preflight transcript  
Verdict: **PASS — runtime identity and cleanup gates satisfied**

## Bound evidence

- Accepted command manifest SHA-256: `3e61e70d2e0d5d5cac9caa14eb23acc4082087608bfbb14d1232493776740b79`
- Result SHA-256: `fe120a7a1de0687cbdd1e7687e85dfa1b129535eff7d3453c72981fee112be3d`
- Initial inspect SHA-256: `4f0a87d60f5cfdcc01e4a419790111faf058764a49e7108a1fa2932860627374`
- Runtime stdout SHA-256: `a3aca28398d74b1f0c73e27c6cfcbb217e5de1d5b6c2e0436244f5514daf8059`
- Post-run inspect SHA-256: `2a63a380baed34b739480968263e9397c40aa0896e5083296b6a99c527c6a067`
- Recorded interval: `2026-09-14T03:03:02.763610Z` through `2026-09-14T03:03:03.088978Z`, within the 15-second outer bound.

Every saved command vector equals its corresponding vector in the accepted manifest. All seven command records use the fixed coordinator environment and report exit code 0, no signal, no problem, and zero stderr bytes. Every stderr artifact is empty. The evidence directory is mode `0700`; the reviewed command, exit, stdout, stderr, inspect, identity, and result files are mode `0600`.

## Gate verification

- Pre-absence returned empty stdout before create.
- Create returned exactly one 64-character lowercase hexadecimal ID: `6c07dc425e289e298c112568e66d68a857f6e64eded189fe1abf6909efa81e3c`.
- Initial inspect binds that exact ID to `/altera-chroot-identity-97bd451e7177`, image `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`, Linux/arm64, and state `created` with `Running=false`.
- The admitted configuration is exact: user `1000:1000`; Node entrypoint and fixed identity expression; `network=none`; read-only root; `CapDrop=["ALL"]`; no added capabilities; unprivileged; security option only `no-new-privileges`; PID limit 16; memory 67,108,864 bytes; one CPU; no mounts, binds, devices, published ports, host PID namespace, or shared IPC namespace.
- Runtime stdout is one exact-key JSON object for `/usr/bin/perl`: canonical path `/usr/bin/perl`, regular and executable true, SHA-256 `a87e4138d1e33d240bd31be3dd5ec59017f729b7aa9bd6b3dc012dfcab85d69b`, header `7f454c460201010000000000000000000300b700`. The header identifies ELF64, little-endian, AArch64 (`e_machine=0x00b7`).
- Post-run inspect retains the same ID, name, image, command, and protected configuration boundary, with state `exited`, `Running=false`, exit code 0, `OOMKilled=false`, and empty state error.
- Remove returned the exact fixed name. Final absence returned empty stdout. The saved result records `cleanup_confirmed=true`.

The create vector contains no candidate seccomp profile. The result explicitly records `candidate_applied=false`, `syscall_probe_run=false`, and `browser_run=false`.

## Boundary

This evidence closes only the accepted image's `/usr/bin/perl` runtime presence, immutable identity, protected baseline configuration, successful bounded execution, and cleanup. It does not establish `chroot` syscall behavior, candidate-profile behavior, Chromium sandbox behavior, or Playwright MCP acceptance. The stopped browser-canary failure count remains **2**.

No command, container, probe, browser, test, authentication, model, native tool, API, source, index, or HEAD mutation was performed for this review.
