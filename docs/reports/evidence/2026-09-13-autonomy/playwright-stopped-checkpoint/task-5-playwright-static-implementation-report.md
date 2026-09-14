# Task5 Playwright static implementation — stopped canary checkpoint

Base and unchanged HEAD: `139954950e91c530772216975d1c85bce4bbd155`.
Scope: the ten runtime build/mapper/runtime/canary source files in `playwright-static/stop-source-proof.json`. The authorized documentation paragraph is not yet edited because browser acceptance failed. No source outside ownership, index, HEAD, auth/config/native/Multica/model/provider operation was changed or executed. No subagents.

## Current result

**Static implementation is prepared; browser acceptance is blocked.** The same no-model canary reached two consecutive real failures and is stopped. No third attempt is authorized by the ordinary retry rule. No accepted production receipt exists, and default Playwright mapping remains `playwright_dynamic_npx` with `mapping_ready:false`.

The second canary reached exact7 environment construction, poison preload non-execution, stdin echo, SIGTERM-to-exit23, package/browser inventory, MCP initialize and tools/list. The first actual navigation launched the exact installed headless shell with sandbox requested and no `--no-sandbox`, then Chromium aborted with `Check failed: sys_chroot("/proc/self/fdinfo/") == 0` and zygote failure/SIGTRAP. This is an actual browser sandbox failure, not an auth/network approval blocker. The exact approved profile permits chroot only in its CAP_SYS_CHROOT include rule, while the runtime drops all capabilities; that is a concrete cause hypothesis, not yet a separate syscall/errno proof. No capability/seccomp/sandbox workaround was applied.

## Implementation prepared

- Isolated four-package exact lock, lockfileVersion3, generated/normalized with npm11.6.2 under Node24.12.0, scripts disabled/offline after official metadata-only retrieval. Docker uses npm ci --omit=dev --ignore-scripts, exact core CLI for Debian libs and matching shell installation, and final nonroot USER1000.
- Exact candidate seccomp bytes `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140`. Duplicate-free parse plus byte/semantic comparison against pinned Moby default proved only the already reviewed clone/setns/unshare insertion. No seccomp alteration.
- Final fixed /usr/bin/env -i vector from root ruling, no custom shim. Native env/argv remain rejected; no dynamic npx execution.
- Optional private receipt reference with external expected SHA and image, exact metadata-before-read, source/vector/platform/version identity and all named evidence hash fields. A template has empty artifacts/checks and does not pass validation. Fake receipt bytes are confined to synthetic unit fixtures; no such receipt launched its own canary. Trusted coordinator remains responsible for accepting actual check evidence and pinning its receipt digest.
- Runtime binds exact generated Playwright TOML, receipt image/source identity, fixed origin and staged private seccomp outside mounts. For now the new network mode is expressly a no-auth/no-model fixture network; existing provider proxy remains unchanged. Later real tester dual-network admission is not claimed.
- The direct Docker bootstrap harness uses only synthetic source/policy and separate RW cache/tmp/evidence, fresh internal isolated bridge, fixed fixture services, no ports/socket/host-home mounts. Cleanup addresses exact generated container/network names. It is fixture evidence, not a production admission bypass.

## Build provenance

Build command vectors and raw logs: `playwright-static/build-command.json`, `build-2-command.json`, `build-3-command.json`, `build-1.log`, `build-2.log`, `build-3.log`, corresponding result JSONs. Minimal context inventory is exactly Dockerfile plus isolated package.json and package-lock.json: `build-context-proof.json` and corrected `build-3-context-proof.json`. No repository/scratch/cache/auth/HOME context was sent to Docker.

First build exited125 before Dockerfile processing: sanitized HOME prevented normal buildx discovery and legacy build rejected --progress. Exact bundled Buildx executable was verified at `/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx`, SHA256 `410c46c9944b4159b7079f8c55adeb4cb5a5452fac86370c51684e8703fe4ffc`. Second build used it explicitly with private empty BUILDX_CONFIG/DOCKER_CONFIG and succeeded. Help/version was not run before that attempt; root's message requiring it arrived after start, and root acknowledged the sequencing. No user Docker credentials/config were read.

First canary then found public browser `deb.deps` installed root:root0600. Exact metadata-only cause proof `canary-cause-1.json` confirmed mode600/UID0 and runner1000. A separate `RUN chmod -R a+rX /ms-playwright` layer adds public read/search permission without write permission. Build3 succeeded; the install layer is explicitly CACHED, so no duplicate browser download occurred for this correction.

Final built image: `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`. Installed browser revision1243/version153.0.8010.12, Linuxarm64/Debian12/Node24.12.0. Installed executable SHA256 `f5d89353cc9ef8dc1541268bbee1f05ee40a31ce3d9799b3a274e5147f6a8cdb`; env executable SHA256 `67a8c7fac47281a5ee335366bcd12f31aa7eeca008cef6eccad38304753ddee9`; browsers.json SHA256 `f1336b4be3fb71a7b9f2c7acf1bd37a43c154434ea719919a2805507094e4bbf`. Full package manifests/tree hashes and browser tree hash are in `installed-artifact-proof.json` and actual canary2 inventory. Browser ZIP digest remains unknown; no extra acquisition was made to recover it.

## Check evidence and persistent counters

All paths below are relative to this report's sibling `playwright-static/`:

- `static-red.log`: expected TDD RED, missing vector/lock/seccomp; `static-green.log`:3/3PASS.
- `mapper-red.log`: expected missing receipt API RED; `mapper-green.log`:1/1PASS.
- `runtime-red.log`: expected admission API RED; `runtime-green.log`:1/1PASS.
- `runtime-missing-receipt-red.log`: meaningful unexpected-admission assertion RED; `runtime-missing-receipt-green.log`:1/1PASS.
- `browser-permission-red.log` and `browser-permission-green.log`: explicit nonroot-readable image contract RED→PASS.
- `canary-syntax.log` and `canary-syntax-2.log`: Node syntax checksPASS before corresponding new code.
- `mapper-covering.log`, `static-covering.log`, `runtime-covering.log`: one current covering run per changed local area (runtime was still running when this checkpoint was first written; final status appended below).
- `canary-1-command.json`, `canary-1.log`, `canary-1-result.json`, `canary-1/control/evidence/canary-report.json`: first real failed canary.
- `canary-2-command.json`, `canary-2.log`, `canary-2-result.json`, `canary-2/control/evidence/canary-report.json`, `main-protocol.jsonl` and `main-stderr.log` in that evidence directory: second real failure. Exact image/container/network inspections and numbered Docker stdout/stderr are retained in each canary directory. Targeted cleanup ran after both failures.
- `failure-history.json` preserves metadata-fetch DNS1→success, npm config1→success, build125→success→successfulchanged-layerbuild, and canary1→1. No “zero actual failures” claim; canary consecutive count remains2. Expected TDD RED is separate.

## What remains unproven

Meaningful navigate/click/fill/submit, screenshot/eviction, source/policy screenshot denial, missing-browser control, redirect sink behavior and acceptance topology network denials, live sandbox/process evidence, before/after trees and profile cleanup did not reach their assertions because browser launch stopped. The standalone host loopback positive listener and container teardown are fixture mechanics, not substitutes for those missing controls. No production receipt or native tester acceptance may be issued from current evidence.

Immutable checkpoint diff: `playwright-static/stopped-review.diff`, 73003bytes, SHA256 `59ba79a448762f85ee25bc50e36bbb201c87691660f9f69cf40f4c5127174997`. Source/base/head manifest: `stop-source-proof.json`. This is an uncommitted review checkpoint, not a completed milestone. No normal-hook commit was attempted while the required browser canary is stopped.

## Final static checkpoint and writer release

All three one-time covering commands completed exit0: static3/3, mapper19/tests and runtime24/tests (exact counts/raw output in their logs). A separate remaining literal lock-integrity/MCP-core dependency comparison passed and is recorded in `static-final-proof.json`; no unchanged suite was rerun.

Build2 image ID: `sha256:b0d67b0db2aaff00e3b12e487099fd9c9f0ff1c78c9e355f998d3dc291e5a8f9`; build3 image ID: `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`. This proof also saves the precise chroot syscall rule and actual container capability/resource metadata. The kernel errno was not observed; attributing failure specifically to seccomp still needs the root-owned cause control.

Canary remains stopped at2. No seccomp/cap changes, receipt or commit. Source writer and HEAD/index are released to root after this report. The checkpoint diff and source hashes remain unchanged. Implementation is incomplete: documentation is not yet updated, normal commit hooks have not run, remaining browser assertions are unexecuted, and production model/browser network admission remains a later contract.

Exit distinction: canary2 `exit:{code:0,signal:null}` is the MCP child/client shutdown result after the failed tool call. It is not browser success. The browser launch log reports `exitCode:null,signal:SIGTRAP`; the outer Python canary command exits1. These three outcomes are retained separately.
