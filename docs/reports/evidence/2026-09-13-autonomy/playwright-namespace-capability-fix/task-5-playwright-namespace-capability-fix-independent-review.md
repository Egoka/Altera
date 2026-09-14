# Task 5 — independent namespace-capability canary review

**Scoped spec compliance: PASS. Scoped code quality: PASS.** No actionable findings in the exact two-file delta. This accepts the offline observation correction under the root ruling; it does not accept any actual namespace row or release a browser invocation.

## Identity and method

Reviewed `task-5-playwright-namespace-capability-ruling.md`, the implementation report, immutable diff, source proof, command metadata and raw RED/GREEN/covering logs. Report SHA256 independently verified: `b0f09d9c11982a9910c39c48e445da18c6292004a72444d95ee336cb4b5bf4a4`. Diff `playwright-static/namespace-capability-fix/namespace-capability-only.diff`: 17,537 bytes, SHA256 `1366ce0375ce3beb87ed013dd87fbc9ae6f471b76b0d81d39528817a4b95b369`.

BASE/HEAD remains `139954950e91c530772216975d1c85bce4bbd155`; this is an uncommitted checkpoint. Trace rejected the execution-worktree outline with SECURITY_VIOLATION. The complete exact diff was read once. Independent in-memory reconstruction from the `.before` artifacts verifies both before/after hashes: canary after `f69c371d6f0c96122c0d0266af626a5952e83d8c4e922f1b86649fee9aa3b3cf`; test after `2aa78d8af67c482f1a6b2a27cd8f9d190c5e98e42ad981a668801f0c2aebf528`.

All eight other release files were hash-checked against the frozen proof, including `test_runtime.py` at `3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc`. Snapshot reader, action observation, current-action completion predicate and screenshot classifier were independently compared byte-for-byte and remain unchanged. No live image, seccomp, vector, runtime or mapper permission changes occur in this delta.

## Capability and namespace criteria

`validateBrowserProcesses` at canary line 152 retains zero effective, permitted, inheritable, ambient and bounding sets for the observer and for the default/outer path. The observer must prove UID/GID1000, namespace identity and readable maps. All browser rows retain exact pinned argv0, UID/GID1000, NNP1, Seccomp2, positive filter count and valid captured fields. The original `--no-sandbox` prohibition remains and now also rejects explicit equals forms. `--no-zygote-sandbox` is recorded without being confused with that distinct prohibition, as required by the ruling.

The exception at lines 186–196 requires exact single UID and GID mappings `1000 1000 1` and proof of a different user namespace. A readable matching namespace identity cannot obtain the exception. EACCES alone is insufficient: both narrow maps must independently differ from the observer's valid maps. Missing or ambiguous identity/maps cannot authorize nonzero sets. An all-zero row with observer-equivalent maps gains no capability exception from EACCES; this follows the explicit ruling's outer-path treatment.

Within a proven inner namespace, inheritable and ambient sets remain zero. Only exactly one `--type=zygote` role may carry precisely `0x200000` in both effective and permitted sets; extra bits, differing sets and role substitution refuse. All non-zygote roles, including the required renderer, retain zero effective/permitted sets. Inner bounding sets are retained as diagnostic values, not treated as an effective grant; observer and outer bounding sets must still be zero. A renderer row is mandatory.

## Collection and failure evidence

`collectBrowserProcesses` at line 92 bounds per-file reads and limits processing to 128 numeric PIDs, retaining a scan error if the inventory exceeds that limit. It captures only the named proc fields, argv, identity/starttime, maps and namespace link/error; it reads no environment and performs no privilege operation. Matched-row read failures retain partial data and refuse validation. Pre-identification ENOENT is the explicit transient-process exception. Rechecks compare starttime, selected status fields, maps, namespace outcome and browser argv. This detects observed inconsistency; it is not an atomic procfs snapshot guarantee.

`inspectBrowserProcesses` at lines 202–206 assigns the complete collection to the report, persists `browser-processes.json`, and only then invokes policy validation. The production call at line 417 uses this wrapper. Thus a policy refusal preserves its offending diagnostic row. The synthetic proc fixture exercises the real collector and wrapper and verifies that an extra-bit capability row and map survive refusal in both persisted and report data.

## Retained verification and canary5 limits

Raw log hashes and exact command metadata match the frozen proof. RED is one expected focused failure from the old actual zero-CapEff assertion applied to a constrained synthetic inner zygote. Focused GREEN passes 1/1; covering passes 8/8. Cases cover accepted inner and independently map-proven EACCES rows, same/ambiguous namespaces, invalid/missing/nonnarrow maps, outer/observer bounding sets, outer/renderer admin, extra/inheritable/ambient bits, UID/binary/NNP/seccomp failures, missing renderer and recorded race errors. No tests were rerun by this reviewer.

Independently inspected saved `playwright-static/canary-5/control/evidence/main-protocol.jsonl`: id8 shows the Name textbox containing Ada; id9 shows `/done?name=Ada` and Complete title; id10 shows the same destination and `FORM_COMPLETE_ADA`. The saved `canary-report.json` remains `accepted:false`, records the old `0000000000200000` versus zero assertion failure, and has no `browser_processes` field. The offending PID, role and namespace were not retained. Therefore canary5 cannot retrospectively prove an allowed inner-zygote case, despite successful form evidence.

The Chromium reference cited by the ruling is rationale for the criterion, not exact-installed-build attribution or actual process proof; it was not used to infer the missing row. Actual diagnostic/map readability and remaining screenshot/network/security/cleanup checks remain unproven.

Browser failure count **5** remains preserved. The root controls release of the two remaining package invocations; this review consumes none and grants no retry or receipt. No browser, Docker, model, authentication, native, Multica, network, configuration, source/index/HEAD mutation, commit or subagent operation occurred. Unrelated accepted components were not reopened.
