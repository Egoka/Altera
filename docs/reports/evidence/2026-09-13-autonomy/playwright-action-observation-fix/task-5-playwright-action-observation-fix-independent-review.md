# Task 5 — independent action/observation offline fix review

Spec compliance: **NEEDS FIX (one delta-specific compatibility gap)**. Code quality: **NEEDS FIX**. The action-before-fresh-observation mechanics meet the narrow requirements, but the final URL assertion now requires an unproven stronger response contract.

## Identity and review method

- BASE/HEAD remains `139954950e91c530772216975d1c85bce4bbd155`; the reviewed changes are an uncommitted checkpoint.
- Report: `task-5-playwright-action-observation-fix-report.md`, independently verified SHA256 `8c89eb733ff17db6940b0f7b32ebdada41304f22e89021f62c55fbae415207f6`.
- Frozen diff: `playwright-static/action-observation-fix/action-observation-only.diff`, independently verified 9,641 bytes and SHA256 `33a97e69da1b7fc50197b8d015835069ba577c053b685aa2f8d0f0b92daf61c8`.
- Exactly `scripts/agent-runtime/playwright-mcp-canary.mjs` and `scripts/agent-runtime/test_playwright_mcp.py` changed. Trace project map was consulted; the execution-worktree outline returned SECURITY_VIOLATION. The complete immutable diff was then read once, without broader source exploration.

Independent in-memory reconstruction from `.before` files and that diff verifies both before/after hashes in `source-proof.json`. Canary after: `f80e150a3e0bf5c51c4a076dae797b7445b560ed2ca29233a32cff065602d76e`; test after: `559df8046db86b2eb7aa056158d8e171f6fcaafa0b34b8496e28d482b711ab76`. Hash-only checks confirm all eight other release sources remain unchanged, including the root's formatting-only `test_runtime.py` pin `3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc`.

## Assessment

### R1 — Preserve contemporaneous action URL evidence separately from fresh snapshot references (P2)

Location: `scripts/agent-runtime/playwright-mcp-canary.mjs:84` (returning only the observed snapshot), together with the Submit call at line 300 and URL assertion at line 301.

The delta discards the successful current action response and moves the existing `/done?name=Ada` assertion onto only the explicit `browser_snapshot` response. Saved evidence establishes that action responses can carry Page URL metadata; neither the saved input schema nor the new offline cases establish that an explicit snapshot repeats that metadata. A successful Submit response with its current Page URL followed by a valid fresh tree containing the completion marker would therefore be rejected if the snapshot omitted the repeated URL. This is a concrete change in the assertion's required output contract, not a claim that the pinned CLI has already exhibited that response combination. Actual snapshot metadata absence remains unknown.

Keep the response from the same just-completed action separately from its fresh snapshot. Resolve refs and the completion marker exclusively from the fresh snapshot; satisfy the final URL assertion from the current action or the fresh snapshot, without carrying forward any prior page/action response or merging stale refs. Add a focused offline case with the current Submit response containing the destination URL and a fresh inline/linked snapshot containing only the completion tree, plus a case where neither supplies the destination URL. This removes the newly imposed metadata-repetition assumption without changing the browser/security contract or requiring a live retry.

The existing tests validate ordering and fresh refs but omit the changed final URL assertion, so their passing evidence does not resolve R1. No new test was run for this review; the dataflow and uncovered assertion are visible directly in the exact diff.

`actionObservation` at canary line 79 awaits action completion, refuses an explicit action error, and then awaits `browser_snapshot` with exactly `{}`. A rejected action promise exits before the snapshot request. A snapshot error exits before observation. Only the fresh snapshot is passed to the existing observer; neither stale action text nor references are merged into it.

All four actual page-producing calls use this sequence: navigation at line 296, Continue click at 298, Name input at 299, and Submit click at 300. Reference selection for the following action therefore reads the latest explicit observation. `requiredTools` at line 77 includes `browser_snapshot` and is used by the actual inventory check at line 252 and the offline contract. The retained tools/list input schema permits `{}`: it has no required properties. This establishes request-schema compatibility, not a future response guarantee.

The previously accepted `snapshotObservation` and screenshot path-denial classifier are byte-preserved. Inline/linked snapshot admission, URL/title handling, launch vector, image, seccomp, runtime, mapper and receipt policy are unchanged. The added helper is a narrow orchestration change and does not create a new observation framework or acceptance authority.

## Evidence independently checked

Read and hash-verified the retained `red.log`, `green.log`, `covering.log` and command metadata under `playwright-static/action-observation-fix/`. RED applies the prior observer to the actual successful empty action response and fails the Submit assertion; it does not depend on a missing module or browser startup. Focused GREEN passes 1/1; the covering log passes 6/6. No test was rerun.

Independently parsed the reconstructed Python fixture literals and compared them with `playwright-static/canary-4/control/evidence/main-protocol.jsonl`: id4 equals `SAVED_FORM_RESPONSE`, id5 equals `SAVED_EMPTY_ACTION`. Protocol SHA256 matches `4ca0a3135ec9fb10052ee9051c85f9ce7a348c4d3de6abc395197a3d464359fb`. The retained `playwright/page-2026-09-14T09-29-07-217Z.yml` equals `SAVED_FORM_YAML` byte-for-byte, SHA256 `d416e11f533bcd98ac148555b4fefe3bea797f7739a8984d3e41469596765f82`.

The test exercises the actual async helper with delayed action completion, checks action-before-snapshot event order and exact snapshot arguments, covers empty navigation/click/type success and inline/linked observations, rejects stale action references, and proves action error/rejection requests no snapshot and performs no observation. Snapshot error also performs no observation. These are meaningful offline checks of the changed contract. Saved id4 is fixture material from an action response, not evidence that a future explicit browser_snapshot invocation has already succeeded.

## Limits and unchanged redirect caveat

The existing redirect control records the sink count and whether its control endpoint is reachable. Endpoint reachability alone does not prove that a browser followed a redirect. Under the supplied binding clarification, the control must record whether the sink received the redirect; a mandatory positive browser hit is not added by this review. This unchanged, still-unexecuted control must be interpreted against its actual evidence, and any absence of routing must be established honestly. It is not a finding introduced by this delta and was not expanded into a separate source audit.

Actual fresh snapshot response shape and post-submit metadata, screenshots and denial wording, redirect/network results, process/capability checks and final cleanup remain subject to actual evidence. Offline tests do not establish them. Browser check count **4 remains stopped**; this review grants no retry, receipt, native acceptance or whole Task 5 acceptance. No browser, Docker, model, authentication, native, Multica, network or configuration operation occurred; no source/index/HEAD write, commit or subagent was used. The report was finalized after the controller requested explicit examination of the changed URL-evidence dataflow; R1 supersedes the earlier provisional pass wording.
