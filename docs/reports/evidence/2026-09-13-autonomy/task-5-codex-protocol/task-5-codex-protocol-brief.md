# Task5 Codex native protocol compatibility (prepared, not dispatched)

Read task-5-codex-bridge-preflight.md first. This bounded milestone removes two demonstrated protocol incompatibilities in the existing trusted Linux launcher. It does not discover/read/mount CODEX_HOME, implement MCP policy, trigger native runs, or prove complete native acceptance.

## Requirements

Baseline for discovery: a51b1116e1e2553605ab704bda2efc1cb463b31b; actual dispatch must record fresh HEAD after D1. Owned scope: scripts/agent-runtime/runtime.py, protocol-guard.mjs, test_runtime.py, test_protocol_guard.mjs, and the corresponding protocol paragraph in docs/development/runtime-isolation.md. No image/package/auth/gate/product/Multica mutation.

Pinned upstream contract: Multica 2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c server/pkg/agent/codex.go launches app-server --listen stdio://. Native thread/start, thread/resume, turn/start may carry params.serviceTier = default. Preserve the full native request unchanged after validation; never coerce another tier. The accepted source currently rejects both shapes (root immutable inspections tools12e359/40e265).

1. Codex CLI arguments: retain existing supported app-server invocation and pinned model/medium pairs; additionally allow exactly one --listen stdio:// pair. Reject duplicate listener pairs, --listen= variants unless upstream evidence requires them (none does), missing value, TCP/Unix/HTTP listeners, trailing unknown arguments, and model/config drift. Do not broaden -c to arbitrary configuration. Forward the valid listener pair intact.
2. RPC: permit non-null serviceTier only when it is exactly default at the direct params.serviceTier field of thread/start, thread/resume, or turn/start. A same-named key elsewhere remains rejected, including nested configuration, arbitrary RPC, or arrays. Keep existing model/provider/effort/cwd/config-write/import defenses and the accepted serviceTierForTurn default behavior. Missing/null still follows existing valid behavior; do not reinterpret the preserved live agent setting.
3. Tests should contain pinned upstream-shaped start/resume/turn messages and their targeted invalid variants, plus a CLI launch-shape acceptance test proving exact forwarded argv. Declare meaningful expected RED before fixing. Run only changed covering suites (no models/Docker/native actions needed for pure argv/JSON validation). Preserve actual historical counts for these checks. Any two consecutive non-RED failures stop the check, never reset by a new run label.
4. Document exactly this compatibility and remaining managed TOML/context/native acceptance blockers. Guard is supplied by hashed RO policy, so a fresh policy capture is required for future canary; no image rebuild is needed solely for this guard edit.

## Evidence / review

Report full commands, RED/GREEN raw outputs, owned diff hash, base/head, and constraints to task-5-codex-protocol-report.md. One writer; no subagents; existing authorization allows scoped normal-hook commit after covering checks and self-review. Exclude root-owned docs/evidence from staging. Root independently reviews immutable scoped diff before integration. Do not mark Task5 complete or bind a runtime from these unit tests.
