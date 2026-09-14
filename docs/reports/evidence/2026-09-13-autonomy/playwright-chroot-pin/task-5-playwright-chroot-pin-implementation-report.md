# Playwright chroot pin implementation

Base/HEAD `139954950e91c530772216975d1c85bce4bbd155`; prior source state is the accepted uncommitted static fix1. Root's `playwright-chroot-preparation/cause-result.json` records actual control chroot(-1,EPERM1), candidate(0,0), same image/probe, namespace/capability checks,14 successful CLI stages, cleanup and unchanged inputs. `chroot-authorization.json` records the owner's exact chroot authorization. This pin-only task does not itself run or accept the browser.

## Exact scope

- `scripts/agent-runtime/playwright-seccomp.json` now equals the frozen candidate byte-for-byte, SHA256 `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`.
- `scripts/agent-runtime/codex_toml_map.py` changes only PLAYWRIGHT_SECCOMP's digest literal.
- `scripts/agent-runtime/test_playwright_mcp.py` changes only test_seccomp_exact_bytes' digest literal.

Duplicate-free parse and restoration of the removed field prove the sole semantic profile delta: deletion `/syscalls/23/includes` with value `{"caps":["CAP_SYS_CHROOT"]}` from the unique chroot rule. All other profile settings remain equal. Hash checks preserve the accepted runtime.py/test_runtime.py/canary fix1 files; the mapper and static test have only the exact literal replacements. No docs/root artifacts, policy behavior, vector, package lock, Dockerfile or image edits. This is path-agnostic chroot admission past seccomp, not added initial/container capabilities; the owner-approved security delta remains precisely that one rule.

## Checks and raw evidence

All commands used `/usr/bin/python3 -I` from the execution worktree. Exact command argv, exit JSON and raw combined output are saved under `playwright-static/chroot-pin/`:

- `red-command.json`, `red-result.json`, `red.log`: focused `scripts/agent-runtime/test_playwright_mcp.py PlaywrightStaticTests.test_seccomp_exact_bytes` expected RED, exit1. Failure is actual old-profile/new-pin SHA mismatch.
- `green-command.json`, `green-result.json`, `green.log`: same focused check, exit0 after exact profile and mapper pin update.
- `static-covering-command.json`, `static-covering-result.json`, `static-covering.log`: `scripts/agent-runtime/test_playwright_mcp.py`,4/4 pass, exit0.
- `mapper-covering-command.json`, `mapper-covering-result.json`, `mapper-covering.log`: `scripts/agent-runtime/test_codex_toml_map.py`,19/19 pass, exit0.

Each changed-area covering suite ran once. The expected RED is separate from real failure counters; no unexpected check failure occurred in this pin task. Historical browser failures remain2 and all original evidence is retained. No unchanged runtime suite, browser/Docker/model/auth/native/Multica operation, image build, receipt, staging or commit occurred.

## Frozen result and remaining gate

`playwright-static/chroot-pin/pin-only.diff`: 1653 bytes, SHA256 `2c32430afe9f476fe253c29212b96a3e14c8f8428c737fcd00010df92a31fde8`. `source-proof.json` records exact before/after hashes, semantic proof, accepted fix1 unchanged hashes and check exits. Three `.before` files retain the prior state. No normal hooks were run because staging/commit remains disallowed. Source writer is released for root's independent scoped pin review. One browser recovery still awaits root's separate dispatch; it has not run. Existing image97bd451e remains unchanged, and no receipt or full milestone acceptance is claimed.
