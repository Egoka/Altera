# Task 5 — reviewer MCP policy milestone

Status: DONE for this bounded milestone; implementation and scoped verification passed; owned commit completed with normal hooks. Full native/Task 5 acceptance remains open.

Base: `d4bf8b898217196b0450d174d0a2a90550a4e66c`. Sole writer; exact seven owned paths listed in `mcp-policy-review/source-proof.json`. Root-owned report, D1 native evidence and Codex protocol archive remain unstaged and unchanged by this work. No D1, guard, Dockerfile/image build, product/gate, native profile/binding, model or auth operation.

## Implementation and self-review

- Claude policy accepts only trace and context7. Trace requires the pinned Linux executable with exactly `["serve"]` or the preserved standalone `["serve", "--preset", "review"]`; omitted stdio type remains compatible. Context7 requires exactly HTTP `https://mcp.context7.com/mcp`. Policy bytes are forwarded without rewriting.
- Unknown names, transport/schema swaps, extra fields including empty headers/env, URL variants, malformed JSON, duplicate keys and non-JSON constants fail closed with fixed non-secret errors. Empty MCP roster remains permitted only as the existing fixture contract, not roster acceptance.
- Proxy change is one exact hostname. Existing public-IPv4-only DNS checks, exact port/authority validation and isolated internal network remain unchanged. Canary client rejects redirects. No image rebuild: runtime/proxy/canary are trusted policy or launcher source.
- New canary runs only Node plus pinned trace inside the boundary. Context7 receives a fixed public React query; no key/auth mount, host source, HOME, Docker socket or model CLI. Opaque MCP session headers are retained only in memory, never evidence. JSON/SSE bodies and stored protocol are bounded. The wrapper creates a fresh synthetic Git repository and independent snapshot, captures manifest/command/hashes, and uses the existing network cleanup.
- Self-review checked exact validator name/type/argv combinations, schema rejection/no policy rewriting, HTTPS authority preservation, no arbitrary tool dispatch, structured real tool results, bounds/timeouts, fresh evidence and source/policy equality. No unresolved implementation defect found in this scope.

## Commands and focused evidence

All paths below are relative to `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution`; each filename is exact. Raw logs are preserved, not overwritten by later checks. Frozen raw SHA inventory: `mcp-policy-review/raw-evidence-sha256.json`.

1. Declared expected RED: `/usr/bin/python3 -I scripts/agent-runtime/test_runtime.py RuntimeTests.test_verified_reviewer_mcp_policy_preserves_both_trace_argv_forms_and_context7 RuntimeTests.test_mcp_policy_rejects_unknown_servers_transports_and_fields RuntimeTests.test_mcp_policy_rejects_duplicate_or_malformed_json_without_echoing_values` → exit1, observed roster rejected; unknown names and duplicate keys wrongly accepted. Raw `task-5-mcp-policy-python-red.log`.
2. Declared expected RED: `/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node --test scripts/agent-runtime/test_proxy.mjs` → exit1 on exact Context7 CONNECT. Raw `task-5-mcp-policy-proxy-red.log`.
3. Declared expected RED: `/usr/bin/python3 -I scripts/agent-runtime/test_mcp_canary.py` → exit1 before new implementation existed. Raw `task-5-mcp-policy-canary-red.log`.
4. Covering runtime final bytes: `/usr/bin/python3 -I scripts/agent-runtime/test_runtime.py` → exit0, 19/19. Raw `task-5-mcp-policy-python-green.log`. Runtime/test bytes remained unchanged after this check.
5. Final proxy bytes after scoped formatting: `/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/node --test scripts/agent-runtime/test_proxy.mjs` → exit0, 2/2. Raw `task-5-mcp-policy-proxy-final.log`; earlier GREEN preserved in `task-5-mcp-policy-proxy-green.log`.
6. Final canary contract tests: `/usr/bin/python3 -I scripts/agent-runtime/test_mcp_canary.py` → exit0, 4/4. Raw `task-5-mcp-policy-canary-final.log`. Earlier 3/3 and shape-corrected 4/4 logs: `task-5-mcp-policy-canary-green.log`, `task-5-mcp-policy-canary-covering.log`. Final rerun followed regression implementation, JS formatting and Python raw-string readability correction; no unrelated suite reruns.
7. `git diff --check --` the five tracked owned files → exit0. New files reviewed in frozen source copies and included in the scoped staged check before commit.

## Real canary — first failure preserved, second success

Exact first command: `/usr/bin/python3 -I scripts/agent-runtime/test_mcp_canary.py --canary /private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/mcp-policy-canary-1`.
Raw launcher log `task-5-mcp-policy-real-1.log`; directory `mcp-policy-canary-1` has `manifest.json`, `prepared-command.json`, `before.json`, `exit.json`, `stdout.log`, `stderr.log`, `run/network-inspect.json`, `run/proxy-inspect.json` and `run/evidence/trace-protocol.json`, `trace-index.log`, `trace-index-exit.json`, `context7-protocol.json`, `forbidden-connect.json`, `reviewer-mcp-result.json`.

Actual exit1, unchanged=true. Context7 initialize/tools/list/resolve-library-id succeeded, six forbidden CONNECT returned403. Trace index exit0 and both real tools succeeded; canary assertion incorrectly required a filename in summary-only map. Saved response contains fileCount1, symbolCount1, languages=[javascript]; the outline contains fresh sample.js::answer#function. This was an implementation assertion failure, not an external blocker. Cause was investigated from raw saved response without another native/model call. Regression command `/usr/bin/python3 -I scripts/agent-runtime/test_mcp_canary.py CanaryContracts.test_trace_summary_counts_and_exact_outline_are_accepted` reproduced the old assertion (declared expected RED, exit1; `task-5-mcp-policy-trace-shape-red.log`). Corrected validator checks actual structured map counts/language and exact fresh outline identity, rejecting zero counts, missing/wrong/stale outline and marker-only text.

Exact second command: `/usr/bin/python3 -I scripts/agent-runtime/test_mcp_canary.py --canary /private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/mcp-policy-canary-2`.
Raw launcher log `task-5-mcp-policy-real-2.log`; corresponding exact files are under `mcp-policy-canary-2` with the same names as first run. Additional `mcp-policy-canary-2/cleanup-image-proof.json` records absence of that exact network/container after cleanup and actual image identity.

Actual exit0; source/snapshot/policy unchanged. Trace3.25.0 used `/usr/local/bin/trace-mcp ["serve"]`, index exit0, tools/list exposed get_project_map/get_outline and both returned accepted actual content. Context7 initialize protocol2025-03-26 succeeded, notifications/initialized accepted202, tools/list exposed resolve-library-id, and its actual result contained five public React library IDs. All six negative authorities returned403, including host/loopback/link-local and Context7 alternate port/trailing-dot/lookalike. No token, auth or model present.

Pinned and independently read-back image: `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a`.
Second canary source full SHA: `ff5b402f15c0ccacb5ee990f27401867e5c8e387`; source tree `318ad37629325732c480ab104eb8118d299f6490`; empty dirty hash `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Second policy SHA256: `13a509487439f67a6e15f0c55c5ce107ed663291fc11e0df374790c3e5f2b38f`.
Second snapshot hash: `85613c0f49ab04afec161e5d68ba4d69edc823b28e4eca926b7859d689f6bc7a`.
Runtime SHA256: `435abda70f7ca56dce248ee5087f1a5dfea6bdb492bb53d6c7fa423a21ae3f99`. Frozen canary source SHA256: `3a472fd7ed360d2802c0acfc64c9d416713e24113be40d0f78a2d38b06e00c80`; second RO fixture copy must match it.

Counters: four declared RED checks (initial runtime, proxy, canary, trace-shape regression) excluded; one real canary failure retained; consecutive real failures now0 after success. No two-failure stop reached in this milestone. Historical Task5/D1 failed build/review records and stopped Task3 counters remain unchanged; no stopped checks retried.

## Immutable review package and remaining scope

Frozen diff: `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/mcp-policy-review/scoped.diff`.
Diff SHA256: `09269fc9c171c7b68c60b09fdf3707240fb1282f144e8156f2371d472c306090`.
Frozen exact seven source copies and hashes: `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/mcp-policy-review/source-proof.json`.
Frozen raw inventory: `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/mcp-policy-review/raw-evidence-sha256.json`.

This proves strict local reviewer policy and real no-model MCP operation in the reused OS boundary. It does not prove managed native argv/stdin/context mapping, Codex per-task config discovery, tester Playwright, model hooks/context, credential refresh or trusted collector. No native profile/binding is authorized by this result. Root retains those milestones and scoped independent review.

## Commit and post-commit verification

Commit: `563844e6461b76c97065842efb1cb0f5b9b5099f` (parent `d4bf8b898217196b0450d174d0a2a90550a4e66c`), exactly seven approved paths. Normal Node24.12.0 hooks passed format, lint, web5/5 and server19 passed/1todo with one skipped file; no stopped product checks rerun outside required hooks. Exact hook output: `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/task-5-mcp-policy-commit.log`.

Post-commit proof: `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/task-5-mcp-policy-commit-proof.json`. Every owned HEAD blob and working file matches frozen tested source SHA; second canary RO fixture matches frozen canary source; root report diff unchanged, staged index empty. Only root-owned report/D1-native/Codex-protocol archive remain dirty. Frozen scoped.diff hash remains `09269fc9c171c7b68c60b09fdf3707240fb1282f144e8156f2371d472c306090`. No further work started.
