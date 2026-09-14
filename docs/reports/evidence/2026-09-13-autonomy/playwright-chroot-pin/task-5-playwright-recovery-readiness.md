# Playwright cause-based recovery readiness

Prepared read-only on 2026-09-14. No source/index/HEAD changes, tests, Docker/browser, auth/model/config/API/Multica operations. Source fix1 is already independently accepted; this is a narrow wiring/readiness note, not a repeat review. Root reports the owner explicitly approved the exact chroot scope. The approval-request document's original “not yet received” status is historical and is superseded by that explicit root dispatch, not by an assumption in this note.

## Gate before any source change or browser recovery

Root must confirm saved, actual two-arm evidence for the unchanged pinned helper and image: control chroot return -1/errno EPERM, candidate return0/errno0, successful required setup and namespace/capability checks, exact applied profile identities, and confirmed targeted cleanup. An unexpected result stops. Source fix1 accepted report `task-5-playwright-static-fix1-independent-review.md` already closes R1/R2, with 25 runtime and4 contract tests passed and fix diff SHA `ce716fbfc00f30fec4a914ed927c3a0780be5a6070b4be16f0d0f7d9eac13670`. No accepted browser result is inferred. The same browser canary remains consecutive failures2 until one explicitly released cause-corrected recovery passes; a failed recovery becomes3 and stops, without renaming/resetting the check.

## Minimal exact source changes after root releases the gate

1. Replace `scripts/agent-runtime/playwright-seccomp.json` with the exact bytes of `playwright-chroot-preparation/candidate.json`: SHA256 `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`. The sole semantic change from the current `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140` is deletion of `includes:{caps:[CAP_SYS_CHROOT]}` in the unique names=[chroot] ALLOW rule. Preserve all other rules/bytes as frozen candidate; do not regenerate or reformat it.
2. Change only `PLAYWRIGHT_SECCOMP` in `scripts/agent-runtime/codex_toml_map.py:53` to that candidate digest.
3. Change only the exact digest assertion in `scripts/agent-runtime/test_playwright_mcp.py:77` (`test_seccomp_exact_bytes`) to that candidate digest.

No runtime.py, runtime tests, canary JavaScript, fixed vector, package locks, Dockerfile, capabilities, general runtime/network or R1/R2 parser edits are needed to select the candidate. Runtime checks the mapper constant; `run_docker_canary` copies the source profile into its fresh private evidence directory and checks that same constant before execution and after cleanup. This automatically wires the updated pin into its runner security-opt. Do not alter the frozen control/candidate/probe evidence. The no-receipt guard remains in force; no receipt is needed or forged for the fixed synthetic bootstrap harness.

The existing image stays `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`. Dockerfile copies only isolated package/lock and installs its dependencies/browser; seccomp, mapper/runtime and canary source are not baked into that build. Saved build3 minimal context contains Dockerfile/package/lock only. Therefore no image rebuild, package acquisition or browser download is required for this profile/pin change. The runner mounts the updated canary file from synthetic RO policy.

## Minimal verification sequence to be dispatched, not executed here

- Preserve the accepted source checkpoint and root's cause/authorization record. In one focused expected RED, update the digest expectation first and run `PlaywrightStaticTests.test_seccomp_exact_bytes` against the old profile. Then install exact candidate plus mapper pin and run the changed static area once: `/usr/bin/python3 -I scripts/agent-runtime/test_playwright_mcp.py` (4 current tests). This validates exact profile bytes, locks/vector and saved-schema contract without Docker.
- Because mapper constant/source receipt identity changes, run its covering suite once: `/usr/bin/python3 -I scripts/agent-runtime/test_codex_toml_map.py`. Do not rerun unchanged R1/R2 runtime coverage, schema/core package discovery, syscall control, image build or unrelated suites without a new cause.
- Freeze new profile/source/diff hashes before the single real recovery. This changes accepted policy identity; old source-based receipts would be invalid. No accepted Playwright receipt currently exists.

## Exact full canary invocation after those gates

Working directory: `/private/tmp/altera-agent-loop-autonomy`.

```json
[
  "/usr/bin/python3",
  "-I",
  "scripts/agent-runtime/test_playwright_mcp.py",
  "--docker",
  "sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426",
  "/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/playwright-static/canary-3"
]
```

`canary-3` is a fresh evidence directory (harness refuses if it exists), not a new check identity. Save exact command and exit plus raw stdout/stderr as `playwright-static/canary-3-command.json`, `canary-3-result.json`, `canary-3.log`. The harness supplies Docker's fixed sanitized environment itself: PATH=/usr/local/bin:/usr/bin:/bin, HOME=/var/empty, DOCKER_HOST=unix:///Users/egorbondarenko/.docker/run/docker.sock. It never mounts that socket. Host orchestration can use the already pinned minimal tool environment and must not inherit new auth/config inputs.

The same full harness runs both synthetic control and acceptance fixture topologies. They use the fixed local web service, a sink only in the control topology, internal isolated bridges, no published ports, nonroot1000:1000, cap-dropALL, no-new-privileges, read-only root/source/policy, separate synthetic evidence/cache/tmp, no model/credentials/host HOME/source checkout/CDP. A live host-loopback synthetic listener is the explicit network negative-control target; this is existing authorized canary behavior, not an application bridge. Browser MCP retains the exact env-i seven-name vector, --sandbox and pinned installed headless-shell path. No --no-sandbox, CAP_SYS_ADMIN, unconfined fallback or added source mount is needed.

Accept only outer canary exit0, both actual mode reports accepted, required browser tool/result/schema/filesystem/network/environment/no-download/process assertions, unchanged RO inventories, exact profile hash and final cleanup. Keep browser process exit/signal, MCP closure status and outer exit distinct. `result.json` is fixture evidence, not production receipt or native acceptance. If canary fails, retain count3 and all partial evidence; do not retry.

## Closure after actual success

The current authorized runtime-isolation documentation paragraph can then describe actual static browser acceptance and its limits, exact approved seccomp delta and receipt/image/source binding. Create a coordinator-accepted receipt only after named successful checks and immutable evidence are reviewed; bind it to updated source hashes, exact unchanged image and actual artifact hashes. Normal mapper/runtime receipt admission still needs its planned concrete proof. Whole native tester/model/provider-browser egress, managed mapping, Multica readback and autopilot acceptance remain separate. No documentation or receipt should claim them from this no-model fixture.

Readiness sources: approval request; accepted source fix1 and preparation fix1 reports; saved canary2 command and source-proof; exact current owned test harness/constants and Dockerfile. Trace project-map/search was attempted first (unindexed symbol); outline path lookup was unavailable for the isolated worktree, so only the exact previously owned files were inspected. No private caches or app source were scanned. Root's two-arm actual result remains pending from this agent's perspective.
