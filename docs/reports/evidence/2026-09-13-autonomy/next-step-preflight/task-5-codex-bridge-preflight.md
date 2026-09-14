# Task 5 Codex native bridge compatibility preflight

Date: 2026-09-14  
Accepted local runtime baseline: `a51b1116e1e2553605ab704bda2efc1cb463b31b`  
Pinned Multica source: [`server/pkg/agent/codex.go` at `2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c`](https://raw.githubusercontent.com/multica-ai/multica/2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c/server/pkg/agent/codex.go)

## Status and boundary

This is a read-only compatibility addendum. It does not authorize or implement another diagnostic, widen D1, inspect a live daemon, read actual `CODEX_HOME`, `config.toml`, or `auth.json`, run a model/native canary/test, or change source, index, or HEAD.

## Pinned native handoff

The pinned Multica backend launches `codex app-server --listen stdio://`. Immediately before spawn it reads `CODEX_HOME` from the daemon-built child environment and calls `ensureCodexMcpConfig(CODEX_HOME/config.toml, opts.McpConfig, ...)`.

For a non-null managed `mcp_config`, including an explicitly empty set, Multica removes inherited `[mcp_servers.*]` tables, writes a marker-delimited authoritative block, and forces mode `0600`. A nil/null `mcp_config` instead leaves inherited user MCP tables available. If managed config exists but `CODEX_HOME` is absent, launch fails closed. This is the Codex equivalent of Claude strict MCP behavior, but it is a per-task config file rather than a `--mcp-config` argument.

The pinned app-server requests also establish these exact shapes:

- `thread/start`: top-level `model`, `cwd`, nil `developerInstructions`, `config.model_reasoning_effort` when configured, and top-level `serviceTier` when configured.
- `thread/resume`: the same live model, cwd, reasoning, tier, and nil developer instructions plus `threadId`; recoverable resume rejection may fall back to `thread/start`, while transport failure does not.
- `turn/start`: reasoning uses top-level `effort`; the same service-tier helper writes top-level `serviceTier`.
- Per-task instructions come from the daemon-written `AGENTS.md` under the supplied cwd. Multica deliberately leaves `developerInstructions` nil to avoid duplicating that file.

## Compatibility with the accepted runtime

The accepted launcher currently creates its own container `CODEX_HOME=/runtime/cache/codex`, optionally mounts one coordinator-owned `policy/codex-config.toml`, and supports one separately referenced `auth_file`. It refuses a real launch until `managed_mapping_verified` is true. This remains the correct isolation boundary; the host per-task home must not be mounted wholesale.

Three narrow bridge changes are required after D1, each with exact rejection behavior:

1. **Launch argv:** accept exactly one native pair `--listen stdio://` after `app-server`, in addition to the already pinned model and medium-effort config pairs. Reject duplicates, another listener, and every other unknown arg. Preserve the pair when starting the in-container Codex app-server.
2. **RPC tier:** keep model limited to omitted/null or `gpt-5.6-terra`; keep effort limited to omitted/null or `medium`. Permit top-level `serviceTier: "default"` only on pinned `thread/start`, `thread/resume`, and `turn/start` request shapes. Continue rejecting `priority`, other tiers, nested/dotted tier overrides, provider changes, config writes/imports, and model/effort drift. The existing broad recursive allowance for `serviceTierForTurn: "default"` is not evidence that pinned Multica uses that key; the pinned source uses `serviceTier`.
3. **MCP materialization:** replace the static “known local trace config” assumption with a trusted, run-specific materialization of the daemon-managed MCP block. Copying or mounting the entire host `CODEX_HOME` is forbidden. The coordinator must produce a `0600` container policy config containing only the validated managed MCP tables plus already accepted runtime policy. Nil/null managed MCP is a blocker because it would re-enable inherited host fallback; an explicitly managed empty set is valid and remains empty.

No priority-to-default coercion is allowed. Before binding, trusted metadata must prove the agent's live model is `gpt-5.6-terra`, effort is `medium`, and service tier is `default` or omitted with an independently proven default. Any other value stops the bridge rather than changing the agent.

## Exact safe metadata discovery prerequisite

The MCP path is environment-only, so the existing generic D0 rule `env_path_unresolved` cannot discover it. No approved daemon readback for this path is evidenced here. The prerequisite is therefore a reviewed Codex-specific metadata-only probe amendment: it may read exactly the `CODEX_HOME` environment value supplied to its own native launch and emit only its bounded, syntactically normalized absolute path plus cwd and presence/status fields. There is no host-home fallback.

The probe must run without model, network, stdin consumption, subprocesses, or config/auth reads. It must not enumerate or emit other environment values, file contents, hashes of secret-bearing files, or a global `~/.codex` path. Secret-canary fixtures must prove that unrelated env and argv values never appear. The probe cannot prove symlink/canonical filesystem identity without touching the path, so it must make no such claim: a trusted coordinator performs the later `lstat`/canonical/root containment check without reading file contents. Missing, relative, syntactically unsafe, symlinked, out-of-root, or changing paths produce `managed_paths_unresolved`.

Only after that metadata gate may a trusted coordinator, in a separately authorized bridge step, validate that the exact `config.toml` is a regular non-symlink file owned by the daemon task home with mode `0600`; extract and validate only the marker-delimited managed MCP block without logging values; map every executable/file path to an existing RO container policy path; and materialize the new container config. `auth.json` remains the existing separate single-file RO credential input and is never merged into MCP discovery.

The trusted run record must bind source SHA and dirty fingerprint, Multica commit, runtime/profile/run IDs, canonical native cwd, discovered task-home identity, trusted config digest, normalized MCP mapping digest, policy hash, image ID, model, effort, and tier. Secret values and secret-bearing raw config stay out of model-visible manifests and logs. A missing marker block, null managed config, unknown MCP transport/key, unmapped path, or mismatch between agent readback and generated block leaves `managed_mapping_verified: false`.

## Preserving AGENTS context

Preserve Multica's native instruction path rather than introducing an inline substitute:

- Snapshot the exact native cwd at the source state used for the run.
- Include the daemon-written per-task `AGENTS.md` bytes, path, Git-like mode, and hash in the declared snapshot inputs. If it is generated, untracked, or ignored, the current snapshot rules do not establish that it is carried; add a narrowly validated input mechanism or stop with `agents_context_unresolved`.
- Mount the snapshot at the same absolute cwd expected by `thread/start` and `thread/resume`; keep `developerInstructions: null` unchanged.
- Reject the run if the file is missing, changes between discovery and snapshot, resolves outside the source root, or cannot be represented without importing another host directory.

The repository's ordinary `AGENTS.md` and the daemon-written task brief may both participate through Codex's normal cwd discovery. The bridge must preserve the actual native tree and precedence; it must not concatenate, rewrite, or replace either file from controller memory.

## Evidence required before any later native canary

- Safe metadata-only discovery proves the canonical per-task home and cwd without reading their contents.
- Agent/runtime readback proves exact model, medium effort, default tier, explicit managed MCP state, and the intended runtime binding.
- Synthetic protocol fixtures cover start, resume, resume-to-start fallback, turn start, allowed default tier, and rejection of priority/provider/config writes/foreign cwd.
- Synthetic launcher fixtures cover the exact `app-server --listen stdio://` argv and reject all variants.
- Synthetic config fixtures prove marker extraction, explicit-empty strict mode, `0600`, path mapping, secret redaction, and rejection of null/global fallback; they use canaries only, never real credentials.
- A context fixture proves the mounted per-task `AGENTS.md` marker is observed with `developerInstructions` nil.
- Only a later, separately dispatched real canary may establish native compatibility. D1 evidence, public source inspection, and this preflight do not do so.

## Preflight verdict

The pinned Multica handoff is compatible in principle with the accepted isolation model, but not with the current launcher/guard as-is. The exact blockers are environment-only discovery of the per-task config, strict extraction/mapping of its managed MCP block, acceptance of the fixed stdio listener pair, and method-scoped acceptance of `serviceTier: "default"`. These can be closed without reading or inheriting a global host home, changing the pinned model/effort/tier, or losing the daemon-written `AGENTS.md` context.
