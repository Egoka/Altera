# Task5 D2: bounded Codex native path metadata

Design/implementation brief prepared by root; not dispatched yet. User authorizes finishing the remaining autonomy work. Existing D0/D1 artifacts and history remain unchanged. This prerequisite discovers only the daemon-supplied path for later validation; it does not read TOML/auth or run Codex.

## Why

Read parent task-5-codex-bridge-preflight.md. Pinned Multica 2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c codex.go takes CODEX_HOME from its child environment and writes config.toml before starting app-server. Accepted d4bf8b8 fixed argv/RPC compatibility. Exact current per-task home is still unknown. Historical managed-paths-historical.json is candidate provenance only, never actual current-path proof.

## Contract

New C executable scripts/agent-runtime/codex-path-probe.c; new build_codex_path_probe.py and test_codex_path_probe.py. Reuse reviewed build conventions without modifying D0/D1. No model, child/spawn/exec/system, network, stdin reads, config/auth/file reads, writes, directory enumeration, Keychain API or env enumeration. Read only getenv("CODEX_HOME") and bounded getcwd metadata. Stdout empty except static truthful --help/--version; diagnostic stderr contains a single bounded ALTERA_CODEX_PATH_ONLY_V1 JSON with source/build identity, read_status, lexical candidate path on exact approved shape, cwd_matches_expected boolean, argc (no argv values), canonical_identity: not_checked, task_acceptance: not_checked. Diagnostic always ends expected78. No offending bytes, unknown path/hash, or environment values on failure. No variable-length scans beyond bounds. No shell, PATH lookup or dynamic interpreter in the diagnostic.

Build pins are non-secret metadata: expected workspace root /Users/egorbondarenko/multica_workspaces_desktop-api.multica.ai/altera-fd1da0aa3ec6; expected cwd /Users/egorbondarenko/WebstormProjects/Altera; UID501. Accept lexical CODEX_HOME only as exactly ROOT/alte-N-SUFFIX/codex-home, N is 1..9 digits, SUFFIX exactly12 lowercase hex, total bytes <=1024. Reject missing/empty, controls, whitespace, non-ASCII, extra levels, alternate root/global .codex, duplicate slash, dot/parent components, trailing slash. Unmatched shape reports managed_paths_unresolved without the value. This catalog intentionally may refuse a changed current daemon layout; do not widen it based on raw secret/config discovery.

No claim about symlinks, owner/mode, existence, mount or canonical identity is possible here: a later trusted root check performs descriptor-relative validation after actual path readback. Runtime env source is trusted daemon production, while inherited arbitrary values are not execution authority. Static probes must not read env at all. Native app-server argv are otherwise opaque; D2 does not parse or emulate RPC, listener, model or task completion. Unknown argv cannot confer extra capability because the diagnostic never uses them for any read/action.

Keep the complete diagnostic stderr line <=1800 bytes, including marker and newline. Pinned codex.go records a 2048-byte stderr tail on handshake failure; preserving the full record within that bound is necessary for truthful native readback. Truncation is a refusal, never a shortened accepted path. No automatic handshake retry or fake app-server response.

## Verification

Meaningful RED/GREEN for candidate path/status/cwd metadata, missing/wrong/overlong values, related and unrelated environment secret canaries, argv secret canaries, empty stdout and exact78; help/version static and nonblocking open stdin. Prove no secret values/hashes appear, including when unrelated env names contain tokens. Compile with accepted explicit Xcode SDK and private compiler temp directory. Capture source/build/binary hashes, expected import list; no file-open/spawn/socket APIs. Use existing real macOS sandbox control/deny approach only where it proves a concrete boundary; do not claim fixture owner/canonical protection this program does not implement. Read exact test outputs, preserve any actual failures; stop after2 consecutive failures of same check, declared RED excluded.

Run only local synthetic fixtures. No profile/native trigger or host model from implementer. Root will independently review frozen source/binary/proof and then prepare a single temporary Codex-family diagnostic profile, bind only idle tester after current state snapshot, trigger one scoped run, drain and restore saved fields. Current source preservation must be captured fresh. Profile deletion is supported cleanup route after disable/unbind; no daemon restart, no runtime-instance deletion for custom profiles. Explicit issue unassignment is recorded with actual assignee_id rather than a nonexistent field.

## Ownership and delivery

Three new files plus a brief accurate D2 paragraph in docs/development/runtime-isolation.md; no changes to runtime.py/proxy/guard, D0/D1, auth, Dockerfile/package, gate, product or Multica. One implementation writer, no subagents. Root supplies exact base at dispatch and holds index/HEAD. Commit owned scope only with normal hooks after focused tests/self-review. Report task-5-codex-path-probe-report.md with commands/raw logs, identities, binary path and unresolved boundaries. Scope acceptance is separate from full Task5.

Global constraints remain those of docs/plans/2026-09-13-autonomy-execution.md: preserve rules/history/source, two-failure stop across runs, no credential output, existing IDs/models/effort/resource/schedules unchanged, native completed is not task acceptance, autopilots remain paused until all gates pass.
