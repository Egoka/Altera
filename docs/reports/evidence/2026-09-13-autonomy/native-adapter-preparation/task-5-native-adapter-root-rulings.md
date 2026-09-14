# Claude native adapter: root interface rulings after live refresh

Date: 2026-09-14. This supplement governs the next adapter dispatch, not a live-run authorization or completion claim. Read together with task-5-claude-native-adapter-brief.md and task-5-native-generation-selection-readiness.md. Implementation has not started.

## Selection and lock

Ruling: select the published current generation in process at actual launch, using Store.select_current; retain the selected descriptor through synchronous runtime invocation and close it in all paths. Preparation references a separately pinned existing store-selection manifest and never freezes an authoritative auth_file. The adapter envelope, store-selection manifest and runtime manifest remain separate schemas. Require the store/generations to exist with trusted metadata before Store construction; no bootstrap or original-login fallback.

The existing API holds LOCK_EX only during pointer selection/open. Do not describe that as LOCK_SH or a whole-run refresh lease. For this one-use controlled canary the controller will not run a refresh concurrently; the adapter never exchanges credentials. Permanent automatic refresh/checker serialization remains a later integration requirement, including uncertain worker cleanup. Retained files do not prove old credentials remain valid after provider rotation.

Ruling: bound native admission lock acquisition to 5 seconds. Extend only Store.locked and Store.select_current with an optional timeout, preserving existing default behavior and existing refresh callers. The bounded path uses monotonic deadline and nonblocking flock, retries only lock contention, and reports a fixed admission-timeout refusal without credential/path output. No nested Store.locked + select_current. Add targeted synthetic contention/release/cleanup tests; do not repeat live exchange. Root must explicitly include credential_refresh.py and test_credential_refresh.py in the writer scope for this narrow API extension.

## Completion evidence

Ruling: this adapter milestone records the actual returned runtime status, wrapper timestamps, pinned input identities and an explicitly untrusted output-file inventory. Raw child exit, signal and worker quiescence remain unknown with current runtime.launch. The record is a runtime-result observation, not accepted process proof, stage acceptance or task completion. This supersedes the earlier brief sentence promising complete actual exit/signal evidence from the existing interface.

The previously planned trusted lifecycle observer and named-worker drain belong to the next shared collector/runtime milestone and must be implemented before gate admission/finish or a full native pilot is accepted. No fake signal derivation from 128+N, no success inferred from model prose, no task_done or gate mutation. One-use invocation and exact external native issue/run readback remain mandatory.

## Owned scope at a future dispatch

New prepare_native_claude.py, native_claude_adapter.py, test_native_claude_adapter.py; narrow Store timeout addition and its focused tests; runtime-isolation.md. runtime.py/test_runtime.py may change only for a demonstrably needed finite-arity parsing helper explicitly named by root before edit. No observer, scheduler, bootstrap, token exchange, auth-format change, profile/API mutation or product source in this adapter implementation. Exact cumulative base and module hashes will be assigned after the current mapper/next sequencing gate; do not revert accepted work.

The cost of these rulings is explicit: one-use native execution can be inspected before a full process receipt exists, but cannot close native Agent Loop acceptance or enable autopilots. A lock timeout can cause a controlled refusal during contention; it must preserve the claim/failure history rather than blind retry.
