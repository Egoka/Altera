# Task 5 Playwright static checkpoint — independent review

**Static spec compliance: NEEDS FIX. Static code quality: NEEDS FIX.** Two Important findings are actionable without another browser run. **Milestone acceptance remains BLOCKED**, independently, by the stopped browser canary at two consecutive failures. This review is not a recovery canary or an authorization to retry it.

Reviewed the exact uncommitted ten-file checkpoint at unchanged base/HEAD `139954950e91c530772216975d1c85bce4bbd155`. Frozen `playwright-static/stopped-review.diff`: 73,003 bytes, SHA-256 `59ba79a448762f85ee25bc50e36bbb201c87691660f9f69cf40f4c5127174997`. `stop-source-proof.json` binds the ten source hashes and records no accepted receipt. Documentation and the normal commit remain pending as explicitly reported; they are not represented as completed work.

## Findings

### R1 — Important: Match canary tool arguments to the pinned MCP schema before spending a recovery attempt

Location: `scripts/agent-runtime/playwright-mcp-canary.mjs:178`–`:180`; related screenshot calls at `:185`, `:189`, `:190`, `:192`.

The canary sends `ref` to `browser_click` and `browser_type`. The **actual saved tools/list** from this exact built image requires `target` for click and `target` plus `text` for type, with `additionalProperties: false`; neither schema declares `ref`. After the sandbox cause is corrected, these calls still cannot satisfy the published input contract, so the required click/fill/submit flow is not ready for its next browser acceptance attempt.

The saved screenshot schema also lists `scale` as required, with default `css`; current screenshot calls omit it. Omission is a published-schema mismatch, but the default means this review does **not** claim certain runtime rejection without actual validation evidence. For negative screenshot controls, malformed input could otherwise be mistaken for a filesystem denial.

Required fix: send the captured snapshot reference as `target`, provide `scale: "css"` consistently, and validate the fixed canary request shapes against the already saved pinned tool schemas using a synthetic/static contract check. Keep the actual browser operations for the separately authorized recovery. Negative screenshot results must establish a filesystem/path denial from a valid tool request, not merely `isError` on an invalid request.

Evidence: `playwright-static/canary-2/control/evidence/canary-report.json`, `protocol.tools` rows `browser_click`, `browser_type`, and `browser_take_screenshot`. This evidence already exists; no model, MCP or browser was invoked to establish the finding.

### R2 — Important: Enforce missing-receipt refusal on TOML semantics or a strictly validated canonical form

Location: `scripts/agent-runtime/runtime.py:374`–`:379`, specifically the raw substring check at `:377`.

When the manifest omits `playwright`, admission searches only for literal case-insensitive `playwright` bytes in `codex-config.toml`. TOML basic strings and quoted keys can express the same server and the exact same fixed executable vector through Unicode escapes, without those literal bytes. The new guard then returns `None`, bypassing its receipt/image/seccomp/fixture-origin checks while the policy still semantically configures Playwright.

The focused synthetic probe constructs that equivalent TOML with a quoted escaped server key and escaped occurrences inside the fixed argv/environment strings. It confirms the decoded server is `playwright`, the decoded vector exactly equals `PLAYWRIGHT_VECTOR`, there are no literal matching bytes, no receipt was supplied, and the frozen guard returns “no Playwright.” No Docker command or model was launched; the probe establishes the admission branch's bypass, not a claim of a successful browser or bypass of every other runtime check.

Required fix: validate an admitted, bounded canonical policy form or inspect parsed semantic MCP declarations before permitting the no-receipt branch. Unsupported/ambiguous spellings must refuse instead of being treated as Playwright absence. Preserve existing ordinary runtime behavior and do not introduce a general TOML dependency solely for this check. Add the equivalent-spelling missing-receipt regression along with the existing literal missing-receipt case.

Evidence: `playwright-static/review-default-guard-probe.py` and sanitized `review-default-guard-proof.json`. The probe extracts only the guard/vector from the hash-verified frozen diff. Its first attempt was correctly refused because the synthetic encoder left uppercase environment names unchanged; `review-default-guard-probe-first-result.json` retains that failure/cause. One correction encoded occurrences case-insensitively, preserving their decoded case; the second observation confirmed the bypass. This was not a browser canary retry or an existing-suite rerun.

## Receipt, build and isolation assessment

- The final vector matches the superseding root ruling: `/usr/bin/env -i`, the exact seven environment assignments, pinned Node/MCP paths, `--headless --sandbox`, the exact revision1243 arm64 executable, and the remaining fixed options in order. No native executable/env argument is forwarded into this vector.
- The mapper's default stays dynamic/unready without an attestation. An empty receipt template fails; a supplied receipt requires a private canonical regular mode0600 single-link bounded file under a private parent, metadata checks before content, the externally pinned digest/image, canonical schema, exact source/vector/platform/version values and complete named artifact/check hashes.
- Receipt hashes are a reference to a **trusted coordinator's acceptance decision**, not independent proof that each referenced check passed. Unit fixtures deliberately fill those fields with synthetic hashes; the runtime receipt path does not inspect or evaluate the underlying check reports. This is consistent with the documented coordinator boundary only while the coordinator actually reviews the evidence and pins the accepted receipt outside all model-writable mounts. Current records explicitly state that no production receipt has been issued.
- Runtime admission with a receipt is deliberately restricted to `playwright-fixture`, `fixture: true`, no auth and the fixed origin. It binds receipt image, generated vector and canary source, validates the staged private seccomp, and checks it again after the run. The direct Docker canary is an explicit bootstrap harness before any receipt exists; it is not evidence of production/native admission. Provider-proxy/real tester topology remains separate as disclosed.
- Dependency manifests contain the four exact versions and integrities, lockfileVersion3, Node24.12/npm11.6.2. The Dockerfile uses `npm ci --omit=dev --ignore-scripts`, the absolute installed core CLI for system libraries and one shell installation, then a separate public read/search-permission layer and final nonroot USER. The seccomp file has the exact approved `ff9cc6…` identity; no chroot/capability workaround is present in this checkpoint.
- Retained installed-artifact evidence binds image `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`, revision1243/version153.0.8010.12, Linux arm64/Debian12/Node24.12, executable/env/descriptor and package/browser-tree hashes. Browser archive digest is explicitly unknown; no second acquisition is claimed.

## What the stopped evidence proves and does not prove

Read the actual covering logs: `mapper-covering.log` **19/19**, `runtime-covering.log` **24/24**, and `static-covering.log` **3/3** passed. They establish local contract coverage, not browser acceptance, and do not cover R1's actual tool argument shapes or R2's semantic spelling case.

Read `static-final-proof.json`, `installed-artifact-proof.json`, `failure-history.json`, the outer `canary-2-result.json`, and the relevant actual `canary-report.json` fields/tool schemas. Canary2 establishes package/browser inventory, exact seven-name environment, poison-preload non-execution, stdin echo and signal-to-exit23 control, MCP initialize and tools/list. It fails on the first real navigation with `sys_chroot("/proc/self/fdinfo/") == 0`, zygote failure and browser SIGTRAP. The saved static checkpoint identifies the seccomp/capability relationship as a cause hypothesis; it does not observe the syscall errno. Root's separate cause investigation is outside this source review.

Outcome distinctions remain truthful: outer Python canary exit1 and `accepted:false`; MCP child/client shutdown code0; browser `exitCode:null, signal:SIGTRAP`. The shutdown code is not browser success. Build permission failure and subsequent cached-install permission correction remain in history. Canary failure count2 and stopped state remain unchanged.

The navigate/click/fill/submit flow, screenshot/eviction, valid source/policy screenshot denials, missing-browser no-download control, redirect/network negatives, browser process/sandbox checks, final immutable tree comparisons and profile cleanup did not reach acceptance. The host listener positive control and exact cleanup mechanics cannot substitute for them. No accepted receipt may be created from the currently reached assertions.

## Review scope and disposition

Read the original brief first, superseding launch/environment rulings, implementation report and source proof. Read the immutable diff once in chunks; subsequently extracted only finding line locations and the named guard/vector for the synthetic probe. Trace returned an execution-path `SECURITY_VIOLATION`; the frozen diff was the authorized fallback. No mutable source crawl, source/index/HEAD edit, private cache/auth/store/D1/D2 read, native/Multica/API/network/model/container action, or subagent was used. No covering suite was repeated.

Return R1 and R2 to the next sole writer as static corrections. This negative static verdict is independent of the already stopped browser check and does not consume or reset a browser recovery. Any expanded seccomp candidate and browser recovery require root's separate concrete authority/cause procedure. Keep milestone status blocked until applied source, independent static disposition and all required actual acceptance evidence agree. No whole-milestone PASS is inferred from this checkpoint.
