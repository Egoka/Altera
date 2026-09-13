# Claude managed-environment evidence gap

Read-only memo, 2026-09-14. No live environment, home, config or credential was read.

## Established observation

The actual native reviewer D0 run `01a09c2f-1cd9-7266-8595-e99adebef720`, reviewer agent `db94a617-807c-4eec-981f-51fd4b3217d4`, ran at 2026-09-13T19:12:10Z–19:12:11Z from `/Users/egorbondarenko/WebstormProjects/Altera`. Its preserved diagnostic at `task-5-d0-native-runs-after-trigger.json:29` reports:

- `env_presence.CLAUDE_CONFIG_DIR: false`
- `env_presence.CODEX_HOME: false`
- `env_presence.TMPDIR: true`
- `env_path_unresolved: true`

The identical diagnostic is retained in `task-5-d0-drain-agent-runs.json:29` and `task-5-d0-drain-issue-runs.json:29`. These are repeated readbacks of the same run, not independent repetitions. Frozen D0 source ID is `a5843cc10aa495bb6cf48e89f80bd121bf66fa582e85a6fb2584cc8691d67107`. Native status failed/exit78 is the intended metadata-only diagnostic, not task/model acceptance.

## What is not established

Neither managed-home variable was present in that observed Claude reviewer invocation. Consequently no lexical path for either variable was established by D0. `env_path_unresolved: true` is deliberate absence of path proof, not evidence of a hidden value. Do not infer a default home path, mount a personal HOME, or infer that a future run has the same environment.

D1’s accepted Milestone A reads one exactly pinned transient daemon MCP JSON; its argv/path catalog and exact candidate descriptor do not discover a managed Claude home (`scratch/task-5-native-bridge-brief.md`, Milestone A; `task-5-d1-report.md`, Limits and remaining acceptance). Its pinned per-user TMPDIR canonical/alias proof concerns only that private temporary input location, not CLAUDE_CONFIG_DIR or CODEX_HOME. The separately prepared Codex-specific D2 prerequisite in `task-5-codex-bridge-preflight.md`, Exact safe metadata discovery prerequisite, remains distinct; it is not proof of a Claude environment value.

## Adapter consequence

Design the Claude adapter against the observed absence without turning it into a permanent assumption: validate environment presence for each actual invocation, and reject a newly present unmapped managed-home input until its semantics/path have independently approved evidence. An isolated dedicated container Claude directory can be an explicit trusted runtime choice; it must not be described as a preservation mapping of a native lexical path that was never observed. Existing authorization proves neither inherited managed settings nor hooks/context equivalence; those remain separate acceptance criteria.

Only existing non-code D0/D1 reports/proofs were inspected. No fresh native operation, environment-value read, config/home traversal, test or source/index/HEAD change occurred. Later D1 native evidence was outside this memo and was not inspected. Root corrected the prior stale phrase “currently active”: that diagnostic completed at21:54UTC and its cleanup was already verified.
