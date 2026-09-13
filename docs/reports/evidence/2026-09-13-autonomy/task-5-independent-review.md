### Spec Compliance

- ❌ Issues found in the prepared implementation: the protocol guard permits a supported per-turn service-tier override (`scripts/agent-runtime/protocol-guard.mjs:17`), and untracked executable-mode changes do not change the claimed source identity (`scripts/agent-runtime/runtime.py:71`). These weaken preserved runtime settings and exact-input acceptance respectively.
- ✅ The preparation scope is otherwise present: independent source snapshot and isolated writable roots (`scripts/agent-runtime/runtime.py:88`, `scripts/agent-runtime/runtime.py:242`), real denial/control and protocol fixtures (`scripts/agent-runtime/test_docker.py:79`, `scripts/agent-runtime/test_docker.py:106`), provider-only proxy (`scripts/agent-runtime/provider-proxy.mjs:8`, `scripts/agent-runtime/runtime.py:317`), fixed Claude login operation (`scripts/agent-runtime/runtime.py:232`), and explicit native acceptance blocking (`scripts/agent-runtime/runtime.py:291`, `docs/development/runtime-isolation.md:16`). The diff contains only the 21 reported runtime/documentation paths; no product status, ADR, owner journal, squad, model binding, schedule, or in_place resource changes appear.
- ⚠️ Full Task 5 acceptance remains BLOCKED: neither this diff nor the supplied newer standalone evidence proves the full native managed MCP roster, native context/hook behavior, both preserved native agents, or automatic credential refresh. The documented block is correct (`docs/development/runtime-isolation.md:16`, `docs/development/runtime-isolation.md:61`, `docs/development/runtime-isolation.md:111`). Verify these through the controller’s native acceptance chain; do not infer them from synthetic fixture success.
- ⚠️ Newer evidence supersedes the implementer report’s outstanding owner-login step: `docs/reports/evidence/2026-09-13-autonomy/claude-persistent-auth/auth-status-proof.json:2` proves fresh-container subscription auth; `model-auth-proof.json:2` records a successful standalone Opus/medium model canary; `manifest.json:3` binds it to 62567862027b3a0ba056a916f9f1466214fcc55e and explicitly excludes native acceptance. Tools-disabled success establishes no hook/context/MCP acceptance. CLI list-cost telemetry is not a measured subscription charge. Root-reported owner-native discovery is original-host evidence, not a container canary.

### Strengths

- Real Docker OS-denial coverage includes a writable sensitivity control and all 18 mutation cases, so a fake/no-op fixture cannot silently satisfy the isolation assertion (`scripts/agent-runtime/fixture.mjs:6`, `scripts/agent-runtime/test_docker.py:79`).
- The boundary is structural: RO snapshot and policy, no inherited host environment, an individual RO credential file, internal isolated network, and an unprivileged separate proxy (`scripts/agent-runtime/runtime.py:23`, `scripts/agent-runtime/runtime.py:242`, `scripts/agent-runtime/runtime.py:260`, `scripts/agent-runtime/runtime.py:317`).
- Unknown native argv and unmapped managed MCP inputs are rejected instead of silently dropping required integrations; real-model and synthetic evidence are explicitly distinguished (`scripts/agent-runtime/runtime.py:127`, `scripts/agent-runtime/runtime.py:171`, `docs/development/runtime-isolation.md:9`).
- Snapshot tests exercise actual temporary Git repositories rather than mocking the identity checks (`scripts/agent-runtime/test_runtime.py:25`, `scripts/agent-runtime/test_runtime.py:57`).

### Issues

#### Critical (Must Fix)

- None found within this task-scoped diff.

#### Important (Should Fix)

1. **[P2] Reject the actual per-turn tier override supported by the pinned app-server.** `scripts/agent-runtime/protocol-guard.mjs:17` checks only `serviceTier`. The pinned image’s generated `TurnStartParams` schema also supports `serviceTierForTurn` and describes it as overriding the tier for a new turn. A focused probe against the exact diff accepted `{"method":"turn/start","params":{"threadId":"synthetic","input":[],"serviceTierForTurn":"fast"}}`. Therefore a native client can request a non-default tier despite the guard’s claimed settings preservation. Add the supported key with explicit default/inherit semantics and a regression case in `scripts/agent-runtime/test_protocol_guard.mjs:17`; audit the pinned schema’s other configuration override forms while implementing the fix. No model request was made by this review.
2. **[P2] Include file kind and executable mode in untracked input identity.** `scripts/agent-runtime/runtime.py:71` records only the hash of bytes or symlink text for each untracked path. In a real temporary Git fixture, snapshotting an untracked script at 0644 and then chmodding the original to 0755 left `fingerprint(source)` identical to the stored state while the snapshot remained 0644. The pre/post checks can consequently accept a different executable input from the original; the current snapshot tests inspect bytes, not this behavior (`scripts/agent-runtime/test_runtime.py:57`). Include the normalized Git file kind/mode alongside its digest and test that a mode change is rejected. File kind must distinguish a regular file from a symlink even when the bytes and link text hash identically.

#### Minor (Nice to Have)

- **Non-pristine canary evidence is correctly disclosed, but is not a pristine end-to-end acceptance run.** `docs/development/runtime-isolation.md:13` records the failed outline argument and correction; the implementer report’s real CLI section also records bundled-bubblewrap fallback output. Preserve these original records, classify the successful component checks accurately, and ensure the later full native canary uses the pinned schema and captures its actual warnings. This is not a reason to repeat an existing suite.

### Review Checks and Scope

- Reviewed only Task 5 plus the verbatim Global Constraints in `docs/plans/2026-09-13-autonomy-execution.md:10`, the complete implementer report, and immutable diff package `review-9e1f8be..6256786.diff` (base 9e1f8be8192df23626efd1ac305269ef00666d22; head 62567862027b3a0ba056a916f9f1466214fcc55e). The initial large diff tool response truncated its middle; recovered only the missing diff sections in bounded groups, not changed source files. No checkout source crawling or Git inspection commands were run.
- Trace-first: `get_project_map(summary_only=true)` succeeded; `get_outline` for the worktree runtime path returned SECURITY_VIOLATION. Used the controller-authorized immutable diff fallback thereafter.
- Focused probe 1, exit 0: actual temporary Git repository plus runtime code extracted from the immutable diff. Observed `fingerprint_unchanged: true` for source mode 0644→0755, with snapshot mode 0644. Temporary fixture cleaned up; no implementation source imported or modified.
- Focused probe 2: generated the pinned image’s app-server JSON schema with network none, RO rootfs, nonroot, cap-drop, no-new-privileges, and only one fresh RW scratch directory. No source, auth, host home, socket, or network mounts. First sandbox transport attempt was denied before CLI execution; approved identical isolated execution then exited 0. Schema and command/result evidence: `/private/tmp/altera-review-schema-yy3b8hut/`; generation warning: `could not create PATH aliases: Read-only file system`. The earlier transport denial is preserved in `/private/tmp/altera-review-schema-mz1v8zek/generation-result.json`. No third attempt occurred.
- Focused probe 3, exit 0: exact guard code extracted from the diff accepted schema-supported `serviceTierForTurn: "fast"`. Reproducible guard/probe files: `/private/tmp/altera-review-guard-k7ojyumj/`. No child CLI or model spawned by the probe.
- Read only the three explicitly supplied, sanitized Claude evidence JSON files outside the diff. Did not read credentials or cache homes. Did not call models, change Multica, rerun existing suites, alter source/index/HEAD, or spawn subagents. The requested review report is the only added file in the worktree.

### Assessment

**Task quality: Needs fixes.**

**Reasoning:** The Docker isolation implementation and fixture strategy are substantial and appropriately distinguish preparation from full native acceptance. Two reproducible contract gaps remain in settings preservation and exact source identity; fix them before trusting wrapper acceptance, while retaining the independent native/runtime blockers.
