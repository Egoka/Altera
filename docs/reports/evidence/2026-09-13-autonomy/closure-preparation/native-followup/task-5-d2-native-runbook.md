# Root D2 native runbook

Prepared only; run after D2 immutable binary/spec/quality/local-proof acceptance. Pinned installed CLI was freshly confirmed as Multica0.4.43, commit2ae2dbbb8, build2026-09-11T23:04:48Z. Do not reuse a rejected/older build.

## Preconditions

- Exact accepted D2 binary/source/build hashes and imports; stdout-empty/local expected78 proof; maximum diagnostic line1800B fits Codex2048B stderr tail.
- Fresh original resource /Users/egorbondarenko/WebstormProjects/Altera HEAD/branch/status and private copies/hashes/modes of all tracked/nonignored paths. No ignored/cache/auth read/copy. Verify resource cwd from the actual native diagnostic as a match boolean, never assume success from earlier D1.
- Fresh scoped CLI readback with explicit workspace c5a721ae-7e4f-41cf-92b9-fd1da0aa3ec6. `--workspace-id` is a supported global flag even though subcommand help omits it; API commands require network escalation here. Never omit the workspace and mistake default-workspace404 for a missing Altera resource.
- Tester5f18f628-67ca-491c-80ae-85ffed2c6687 idle on original Codex runtime10b7bf57-0972-4439-aa71-2a2c30af4484, modelgpt-5.6-terra, medium, max1. Capture all fields to preserve privately; durable output is an allowlist only. No queued/dispatched/running/deferred tester/issue task; all three autopilots paused; no competing assignment/dispatch. Existing D1 profile/runtime are already deleted.
- Diagnostic issue ALTE-11/01a09bb3-96bf-7532-8d34-e384d9ac5ed2 must have fresh `assignee_id`/`assignee_type`/status readback. Record exact prior values; do not use nonexistent assignee_agent_id. If another active stage owns it, choose no trigger and resolve scope first.

## One bounded execution

1. Write private trigger contract: one metadata-only Codex process, no model/child/config/auth reads, expected78, claimed task acceptance not_checked. Pin observed binary in a new Codex-family temporary profile using exact absolute command path. `set-path` alone previously required daemon restart; use known-working absolute command-name and never restart shared daemon.
2. Verify this runtime online/private and exact profile command/family/binary identity before binding. Save original tester runtime/model/effort/concurrency/other fields and recheck quiescence.
3. Temporarily update only tester runtime to this diagnostic runtime. Assign ALTE-11 with `--to-id TESTER --no-start`. Verify assignment via actual assignee_id and unchanged agent fields. Recheck source snapshot before trigger.
4. Exactly one explicit issue rerun. Record new native task ID, start/end/status/attempts and bounded D2 stderr JSON. Native failed/78 is expected diagnostic behavior. Require exact marker/source/build IDs, accepted lexical candidate under pinned root, cwd match and canonical_identity:not_checked. A lexical path does not authorize config reads or a model launch.
5. Drain all nonterminal/deferred runs before restoring a host-capable runtime. Preserve full attempt history privately; archive allowlisted diagnostic only. Do not issue a second trigger because the protocol did not handshake: handshake refusal is intended. Unresolved metadata means this diagnostic result is a gap, not permission to widen paths.

## Cleanup regardless of diagnostic result

- Restore tester's saved fields/runtime only after drain; compare field readback. Restore the precisely captured prior issue assignment/status where compatible with avoiding a trigger; for previously unassigned issue use plain `issue assign ID --unassign`, never combine with --no-start. No automatic start while restoring metadata.
- Disable own temporary profile with `--enabled=false` (not separate false positional value). Confirm no agents bound and no run pending. Remove own local path pin only if one was set.
- Delete own disabled/unbound profile, not its runtime instance: current server rejects direct custom-runtime deletion and instructs profile deletion. No cascade and no daemon restart. Verify both profile and associated runtime are absent; original runtimes/agent fields remain.
- Verify original HEAD/status and tracked/nonignored paths unchanged against fresh snapshot. If concurrent owner changes occurred, preserve both and report the evidence gap; never restore wholesale or attribute changes without proof.
- All historical errors and same-check counters remain. After two consecutive unexpected failures stop that check; any cause-corrected recovery requires a recorded specific cause and one-use ruling. Missing marker/cwd/path proof cannot be called model/native/Task5 acceptance.

## Next boundary

Only after an accepted lexical path may a separately reviewed trusted operation validate that exact task-home/config path through held descriptors, owner/mode/type checks and bounded strict TOML parsing. This runbook itself grants no config/auth read, no secret-bearing file hash and no host model. Tester Playwright/MCP configuration and Codex AGENTS context still need actual evidence before their adapter is accepted.
