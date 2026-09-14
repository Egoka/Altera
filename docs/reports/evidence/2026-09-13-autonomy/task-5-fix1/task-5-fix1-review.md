### Finding Verdicts

- **Reject the actual per-turn tier override supported by the pinned app-server — ADDRESSED.** `scripts/agent-runtime/protocol-guard.mjs:24` now permits only null/inherit or explicit `default` for `serviceTierForTurn`. Lines 9–13 reject config mutation/import RPCs; lines 20–24 check nested reasoning, tier and provider overrides; lines 28–34 restrict arbitrary thread config keys. The new tests cover standard-speed acceptance, fast/flex/unknown rejection, thread start/resume/fork config overrides, dotted/nested profiles, provider changes and config write/import routes (`scripts/agent-runtime/test_protocol_guard.mjs:35`, `scripts/agent-runtime/test_protocol_guard.mjs:51`, `scripts/agent-runtime/test_protocol_guard.mjs:74`).

  Prior finding, verbatim:

> **[P2] Reject the actual per-turn tier override supported by the pinned app-server.** `scripts/agent-runtime/protocol-guard.mjs:17` checks only `serviceTier`. The pinned image’s generated `TurnStartParams` schema also supports `serviceTierForTurn` and describes it as overriding the tier for a new turn. A focused probe against the exact diff accepted `{"method":"turn/start","params":{"threadId":"synthetic","input":[],"serviceTierForTurn":"fast"}}`. Therefore a native client can request a non-default tier despite the guard’s claimed settings preservation. Add the supported key with explicit default/inherit semantics and a regression case in `scripts/agent-runtime/test_protocol_guard.mjs:17`; audit the pinned schema’s other configuration override forms while implementing the fix. No model request was made by this review.

- **Include file kind and executable mode in untracked input identity — ADDRESSED.** `scripts/agent-runtime/runtime.py:72` uses lstat to distinguish symlink versus regular file, normalizes modes to 120000/100644/100755, and stores kind/mode/SHA together at line 82. Real Git tests prove both source and snapshot reject executable-bit and identical-digest file-kind changes; the normalization test checks that 0600 and 0644 remain equivalent under Git’s mode semantics (`scripts/agent-runtime/test_runtime.py:80`, `scripts/agent-runtime/test_runtime.py:96`, `scripts/agent-runtime/test_runtime.py:114`). Legacy untracked manifest hashes fail comparison and require fresh capture, as documented in `docs/development/runtime-isolation.md:39`.

  Prior finding, verbatim:

> **[P2] Include file kind and executable mode in untracked input identity.** `scripts/agent-runtime/runtime.py:71` records only the hash of bytes or symlink text for each untracked path. In a real temporary Git fixture, snapshotting an untracked script at 0644 and then chmodding the original to 0755 left `fingerprint(source)` identical to the stored state while the snapshot remained 0644. The pre/post checks can consequently accept a different executable input from the original; the current snapshot tests inspect bytes, not this behavior (`scripts/agent-runtime/test_runtime.py:57`). Include the normalized Git file kind/mode alongside its digest and test that a mode change is rejected. File kind must distinguish a regular file from a symlink even when the bytes and link text hash identically.

### New Breakage in the Fix Diff

- **Minor — inaccurate image rebuild requirement.** `docs/development/runtime-isolation.md:161` says modifying `protocol-guard.mjs` requires rebuilding the image and obtaining a new immutable image ID. In the previously reviewed implementation, the guard is loaded from `/runtime/policy/protocol-guard.mjs` through the RO policy bind mount; `.dockerignore` excludes all files except Dockerfile, and Dockerfile contains no guard COPY. Thus a guard edit does not change the image contents or require a new image ID. Replace this instruction with fresh policy hash/source identity and canary evidence; retain the pinned image ID when its contents are unchanged. The fix report repeats the same mistaken instruction. This does not block the code fix round.
- No new Critical or Important breakage found in the five-file fix diff.

### Out-of-Scope Observations

- Full native managed MCP/context/hook/refresh acceptance remains pending, separately from this fix verdict (`docs/development/runtime-isolation.md:16`). The updated documentation correctly distinguishes newer standalone Claude owner-login/model proof from native acceptance. The parent’s discovered native MCP roster and transient managed config lifecycle do not by themselves establish a container adapter. No additional out-of-scope code findings.

### Checks

- Reviewed immutable `review-6256786..c038388.diff`, base 62567862027b3a0ba056a916f9f1466214fcc55e, head c03838840dc0aeb5003221ae10fec75ebb16a59b; only the two prior Important findings and new fix breakage were assessed. The first combined tool response truncated the fix-report and documentation portion; recovered those omitted text sections only. Did not reread changed source files or issue Git inspection commands.
- Read the appended fix report and existing focused RED logs: Python 3 tests/5 expected failures and protocol 3 tests/3 expected failures, all corresponding to the previously missing checks. These are regression evidence, not new runtime failures.
- Read final covering logs directly: `task-5-fix1-python-final.log` reports all 14 tests passing; `task-5-fix1-protocol-final.log` reports all 6 guard/proxy tests passing, no skips/todos/failures. The diff assertions cover real source/snapshot refusal and guard behavior, not only the implementation’s return structure.
- Read `task-5-fix1-schema-audit.json` for the already-generated pinned schema and `task-5-fix1-result.json` for the reported exact commit/scope match and hooks exit 0. No schema regenerated, suite rerun, focused probe, Docker/model/native/auth invocation, credential access, source/index/HEAD/Multica change, or subagent dispatch was necessary. Only this requested review report was written.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** Both original Important findings are closed for c03838840dc0aeb5003221ae10fec75ebb16a59b. Correct the nonblocking policy-versus-image documentation statement; full native acceptance stays pending.
