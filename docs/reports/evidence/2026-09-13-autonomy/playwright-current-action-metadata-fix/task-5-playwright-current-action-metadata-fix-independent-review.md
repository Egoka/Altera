# Task 5 — scoped current-action metadata re-review

**R1 ADDRESSED. Scoped spec compliance: PASS. Scoped code quality: PASS.** No new actionable breakage found in this two-file fix.

## Frozen scope

This reviews only R1, “Preserve contemporaneous action URL evidence separately from fresh snapshot references,” and breakage introduced by its correction. The prior negative review remains preserved in `task-5-playwright-action-observation-fix-independent-review.md`; this pass supersedes its unresolved finding, not its history or live-evidence limits.

- BASE/HEAD remains `139954950e91c530772216975d1c85bce4bbd155`, with an uncommitted checkpoint.
- Report `task-5-playwright-current-action-metadata-fix-report.md`: verified SHA256 `afec9701f6676283d02cd2efcd501499c3ca5585e4bb70a6950984a77c589f94`.
- Frozen `playwright-static/current-action-metadata-fix/current-action-metadata-only.diff`: verified 6,009 bytes, SHA256 `50f765034a16a756e8900ac1c9aa8357b4eeab513854dc95c34aca9281b369f2`.
- Canary after hash: `00c1f72a1e5b92c84ce9d41da40dc5dfd72dddd8d28e1c4be16441120f9345e9`; test after hash: `d0b24d192d58746f699fc5f67ba076f9130e380af244849d14f3d7f7c2b6ded3`.

Trace rejected the execution-worktree outline with SECURITY_VIOLATION. The immutable diff was read once. Independent in-memory reconstruction from frozen `.before` files verified both before/after source hashes. All eight other release sources were hash-checked against `source-proof.json`, including `test_runtime.py` at `3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc`. No source crawl or execution was needed.

## R1 assessment

`scripts/agent-runtime/playwright-mcp-canary.mjs:84` now returns the successful current action separately from its freshly requested and observed snapshot. The existing await/error ordering is unchanged. `completedPage` at lines 86–88 requires the completion marker from the fresh snapshot and accepts the destination URL from the current action or that fresh snapshot. It has no previous-page input or fallback.

All three actual reference lookups at lines 302–304 explicitly use `page.snapshot`. The initial marker at line 301 also uses the fresh snapshot, and the production final assertion at line 305 calls the same `completedPage` predicate exercised by the offline contract at line 126. Action references and action-only completion markers cannot satisfy those fresh-observation checks. Each reassignment receives a new action/snapshot pair; no prior action is merged into it.

The accepted bounded snapshot reader and screenshot path-denial classifier were independently compared byte-for-byte and are unchanged. The delta does not alter inventory, launch vector, image, security profile, runtime, mapper or receipt policy.

## Retained verification

Read and hash-verified `commands-and-results.json`, `red.log`, `green.log` and `covering.log` in `playwright-static/current-action-metadata-fix/`. RED is one focused invocation with two expected failing subcases: current action URL plus fresh inline or linked tree-only completion incorrectly fails the old snapshot-only predicate. GREEN passes 1/1; the covering run passes 7/7.

The regression cases exercise the shared production predicate. They cover current-action URL with both tree forms, empty action with fresh snapshot URL, rejection when neither current response supplies the URL despite a prior-page fixture containing it, and rejection when only the action carries the completion marker. Fresh snapshot text excludes stale action refs. Retained orchestration tests still cover action error/rejection and snapshot-error behavior. The evidence resolves R1 without assuming or testing any new live response shape. No tests were rerun by the reviewer.

## Limits

Browser check count **4 remains stopped**. This offline re-review grants no retry, receipt, browser acceptance, native acceptance or whole Task 5 completion. R1 concerned an unsupported metadata-repetition assumption, not an observed additional browser failure. Existing redirect-control interpretation and all pending actual browser/security/cleanup evidence remain unchanged and were not reopened. No browser, Docker, model, auth, native, Multica, network, configuration, source/index/HEAD mutation, commit or subagent operation occurred.
