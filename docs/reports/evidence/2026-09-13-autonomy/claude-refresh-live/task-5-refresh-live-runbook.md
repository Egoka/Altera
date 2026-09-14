# Task 5 — bounded root live refresh operation

Status: prepared only, not executed. Implementation review and commit identity are pending.
The user's repeated instruction to close autonomy blockers authorizes this necessary
operation; no new generic confirmation is needed. A fresh user login is needed only
if the supported refresh path actually establishes that it cannot continue.

## Preconditions

1. Independently accepted exact nine-file implementation commit and frozen evidence.
2. Pinned image sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a
   and reviewed wrapper/proxy content identities match before operation.
3. Validate only metadata/path identities for original private login source:
   `/Users/egorbondarenko/Library/Application Support/Altera/agent-auth/claude/login-run/cache/claude/.credentials.json`.
   No read/hash/parse/log of its contents through diagnostic tools. Only the reviewed
   opaque bootstrap may copy it, preserving the original.
4. Stage reviewed executable dependencies in a fresh private trusted root outside all
   model mounts. Root/profile installation is separate. Exact CLI dependencies and
   policy hashing routine must be read from the frozen reviewed interface before
   constructing a manifest; do not reconstruct them from memory or use a guessed hash.
5. New private credential store must live under the existing persistent Altera
   agent-auth parent, not /tmp. Policy and run directories are distinct private paths.
   Refuse an existing store/journal/attempt; inspect nonsecret state and recover only
   through the reviewed entrypoint if prior live work exists.

## Stable operation identity and sequence

Declare `check_id=claude-refresh-live-v1`, initial consecutive failures 0 only after
confirming no recorded prior attempt of this exact check. Allocate one random opaque
attempt ID and retain it in a private preparation record before bootstrap. This is a
new live check, not a renaming/reset of the stopped Task 3 checks. Preparing this
runbook is not an attempt and has not changed any failure count.

Use the reviewed CLI interface:
`/usr/bin/python3 -I ABS_REVIEWED_COORDINATOR ABS_MANIFEST bootstrap ABS_SOURCE` once,
then `... ABS_MANIFEST refresh` once. The refresh call is the bounded coordinator
transaction: exchange, fresh status, fresh fixed Opus marker acceptance, atomic
publication. The fixed constants and child commands are those in
`task-5-refresh-root-rulings.md`; do not introduce an override, external API billing,
owner HOME/config, source mounts, tools, or nonempty MCP roster.

Inspect safe coordinator result and the nonsecret pointer/journal only. Verify actual
process result and targeted cleanup; keep a generation changed boolean, stage outcomes,
fixed marker acceptance, image/policy identity, timestamps and allowlisted usage/list
estimate. Never archive credentials, their digests, raw CLI output, account identity,
or a recursive private-root snapshot. The old source/generation remains retained.

## Failure behavior

Do not blindly repeat the command after an ambiguous or failed exchange. Preserve the
same check/attempt and journal, establish the stage using only allowed state, and use
candidate recovery only if the reviewed state machine authorizes it. Missing/invalid
candidate after exchange_started means manual_login_required. A timeout/transport
failure is not proof of provider rejection and cannot be reported as successful cleanup
without an actual result. No browser/model/API fallback and no token guessing.

## Acceptance boundary

Live refresh is accepted only after successful real exchange, fresh candidate status,
fresh fixed Opus marker and published pointer, with reviewed process cleanup. This
alone does not install native adapters, prove native context/hooks, accept a project
task, apply Multica fields, or enable any autopilot. Those milestones remain separate.
