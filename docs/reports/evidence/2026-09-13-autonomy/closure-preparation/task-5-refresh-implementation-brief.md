# Task 5 Claude refresh implementation brief

> Preparation only. This brief does not authorize a live credential exchange, a model call, access to an auth file, or a rerun of either stopped check.

**Inspected implementation base:** `d4bf8b898217196b0450d174d0a2a90550a4e66c`

**Inputs:** `task-5-auth-refresh-preflight.md`, `docs/development/runtime-isolation.md`, the current `scripts/agent-runtime/runtime.py` interfaces, and the pinned Claude CLI `2.1.263`.

## Goal

Add one trusted-container operation that exchanges the refresh credential already held in the current Claude credential generation, validates the CLI-written candidate in fresh containers, and publishes that generation atomically. The checker continues to receive one selected credential file read-only. The refresh path has no source checkout, prompt, model tools, MCP configuration, guard authority, Multica token, host HOME, Docker socket, or host-exec bridge.

The operation is not a browser-login fallback and does not use `claude setup-token`. Current Claude documentation describes `claude auth login` with `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` and `CLAUDE_CODE_OAUTH_SCOPES`; it does not establish which CLI release first supported those variables. Support in the pinned CLI must therefore be proven synthetically before a live exchange.

## Exact implementation surface

Create:

- `scripts/agent-runtime/credential_refresh.py` — trusted host coordinator: store validation, lock, journal, recovery, container sequencing, and atomic publication.
- `scripts/agent-runtime/claude-refresh.mjs` — mounted reviewed policy executable. It reads the old file inside the container, extracts only the approved refresh fields, gives them only to the fixed CLI child environment, suppresses child output, and emits a fixed allowlisted result.
- `scripts/agent-runtime/test_credential_refresh.py` — coordinator, lock, crash-recovery, publication, and command-construction tests.
- `scripts/agent-runtime/test_claude_refresh.mjs` — synthetic credential parsing, child-environment, redaction, timeout, and exit-classification tests.
- `scripts/agent-runtime/test_refresh_docker.py` — Docker-bound tests with synthetic files and a fake exchange executable; it must not read a real credential or contact a provider.
- `scripts/agent-runtime/refresh-manifest.example.json` — path-only example with no secret values.

Modify:

- `scripts/agent-runtime/runtime.py` — extract the existing shared Docker sandbox arguments into a reusable helper and add a dedicated refresh/status command builder. Keep ordinary protocol and `claude-login` behavior byte-for-byte equivalent at the command boundary. The refresh builder must not call the source snapshot or protocol-policy preparation paths.
- `scripts/agent-runtime/test_runtime.py` — lock down the unchanged ordinary-runtime command and prove that refresh/status commands cannot acquire source, model, MCP, stdin, or writable checker-auth mounts.
- `docs/development/runtime-isolation.md` — after implementation and review, document the store layout, fixed operations, recovery states, and the separate live-acceptance procedure.

Do not change `scripts/agent-runtime/Dockerfile` merely to add the wrapper. Mount only the reviewed wrapper file from the private policy generation as read-only and bind its non-secret content digest in the run policy. Do not mount its repository directory or any source tree.

## Required design rulings before coding

The accepted documents leave three details unspecified. The implementer must not choose defaults:

1. **Pinned credential schema.** Record the exact JSON property path and type for the refresh token and scopes used by Claude CLI `2.1.263`. Establish it from a reviewed public/pinned CLI artifact or a wholly synthetic CLI-created fixture. Do not inspect a real auth file. The wrapper must accept only that exact shape; it must not recursively search for keys or support guessed aliases.
2. **Fixed bounds.** Root must pin the maximum credential-file bytes, maximum JSON depth/string length, child-output capture bytes, and exchange/status timeouts. Tests use those constants and prove fail-closed behavior. No manifest-controlled or environment-controlled override is allowed.
3. **Live model acceptance command.** Root must pin the already-approved model, effort, fixed marker prompt, and expected marker before the one real acceptance. The refresh implementation must not infer them from host configuration.

These are implementation parameters, not new auth policy. The supported flow, isolation boundary, single-writer rule, and failure behavior are already approved.

## Credential store and trusted flow

Use a private store owned by the invoking user:

```text
credential-store/
  refresh.lock
  current.json
  refresh-state.json
  generations/
    <old-generation>/.credentials.json
    <candidate-generation>.pending/.credentials.json
```

`current.json` contains only one validated generation basename. It is an atomically replaced regular file, not a symlink. Store directories are mode `0700`; lock, pointer, journal, and credential files are mode `0600`. Before each use, reject symlinks, non-regular files, hard links, wrong owner/mode, path escape, unexpected generation names, oversize files, or a publication rename crossing filesystems.

`credential_refresh.py` takes an exclusive single-writer lock before reading the pointer and holds it through recovery, exchange, candidate acceptance, and publication. Checker generation selection must use the same lock while resolving and opening the current generation, so it cannot race pointer publication. It may release the lock after it has an open descriptor or a canonical generation path whose parent cannot be replaced under the store rules.

The coordinator writes a non-secret, atomically replaced journal and fsyncs the file and parent directory at every transition:

```text
prepared -> exchange_started -> candidate_written -> candidate_accepted -> published
```

The journal may contain the input/candidate generation IDs, attempt/check ID, pinned image identity, reviewed wrapper/policy identity, stage, and fixed status enum. It must not contain credential bytes, token-derived hashes, CLI output, account identity, email, organization, or provider response bodies.

Before starting the CLI child, persist `exchange_started`. Create a new `.pending` directory with exclusive creation. Mount:

- the old generation file read-only at `/runtime/input/.credentials.json`;
- the empty candidate configuration directory read-write at `/runtime/output/claude`;
- the reviewed wrapper read-only at `/runtime/policy/claude-refresh.mjs`;
- private empty HOME/cache/tmp paths; and
- the existing provider-proxy network only.

Set `CLAUDE_CONFIG_DIR=/runtime/output/claude`. Do not place the refresh token or scopes in Docker `--env`, argv, stdin, the host process environment, a manifest, or a temporary host file. Inside the trusted container, the wrapper reads the mounted old artifact, validates its exact approved shape, constructs a new child environment in memory, adds `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` and `CLAUDE_CODE_OAUTH_SCOPES`, and spawns exactly:

```text
/usr/local/bin/claude auth login
```

The wrapper captures bounded stdout/stderr and never forwards it. Its externally visible result is a fixed enum and exit classification only. It must clear the two secret variables from its own subsequent children and must not print exceptions that embed parsed values.

On success, validate the candidate path and metadata without parsing or hashing secret values on the host. A fresh status container then mounts only the candidate file read-only at `/runtime/cache/claude/.credentials.json`, sets `CLAUDE_CONFIG_DIR=/runtime/cache/claude`, and runs fixed `/usr/local/bin/claude auth status`. Parse its documented JSON internally and expose only the approved boolean/fixed-enum result. Publication is an atomic `current.json` replace followed by directory fsync. Retain the previous generation; garbage collection is outside this milestone.

## Transactional recovery

Recovery runs under the same exclusive lock before any new exchange:

- `prepared`, with no CLI child ever started: remove only a proven-empty pending directory and start a new attempt.
- `exchange_started` or later, with a valid candidate present: never exchange again. Continue with fresh-container acceptance and, if accepted, publication.
- `exchange_started` or later, with a missing or invalid candidate: retain the journal and any pending artifact, leave the old pointer unchanged, return `manual_login_required`, and stop.
- `candidate_accepted` with the old pointer: publish the already accepted candidate idempotently.
- pointer already naming the candidate while the journal precedes `published`: verify both and advance the journal idempotently.
- revoked, expired-and-unrefreshable, timeout, crash, or ambiguous CLI/provider result after `exchange_started`: never retry the old refresh token, never discard the candidate, and never fall back to browser login, `setup-token`, a model request, or a direct provider request.

The old pointer remaining in place is rollback of publication only; it is not evidence that the old refresh token remains reusable.

## TDD sequence and focused synthetic evidence

Run the existing runtime unit suite after each command-builder refactor, then add these focused cases:

1. `test_refresh_command_has_no_source_model_mcp_stdin_or_secret_docker_env`
2. `test_refresh_and_checker_selection_share_one_lock`
3. `test_wrong_owner_mode_symlink_hardlink_escape_and_oversize_fail_closed`
4. `test_exchange_started_is_durable_before_child_spawn`
5. `test_crash_after_exchange_uses_existing_candidate_without_second_exchange`
6. `test_missing_candidate_after_exchange_requires_manual_login_without_retry`
7. `test_candidate_accepted_publishes_pointer_atomically_and_retains_previous`
8. `test_pointer_published_before_journal_recovers_idempotently`
9. `test_status_and_journal_contain_no_secret_or_secret_digest`
10. `test_exact_pinned_schema_only_and_no_recursive_key_discovery`
11. `test_refresh_token_and_scopes_exist_only_in_fixed_child_environment`
12. `test_child_stdout_stderr_exception_and_timeout_are_bounded_and_redacted`
13. `test_synthetic_success_failure_timeout_concurrency_and_interrupted_publication`

Use high-entropy synthetic canaries in token, scopes, irrelevant JSON fields, child output, and thrown errors. Assert their absence from argv, Docker environment, logs, journal, result JSON, evidence, and test failure output.

Add one pinned-image compatibility check with a synthetic token and no real credential. It must prove that Claude CLI `2.1.263` selects the documented non-browser refresh-token path, exits within the fixed timeout on an intentionally invalid synthetic exchange, emits no interactive prompt/browser handoff to the trusted boundary, and contacts only the provider proxy. This check may use the existing proxy trace to prove the allowed destination, but it must not expose the synthetic token or provider body.

Passing synthetic tests establishes implementation behavior only. It does not establish that a real refresh succeeds.

## Separate real acceptance

After code review, pinned-schema evidence, pinned timeout/bounds, and the synthetic suite pass, obtain the already-required explicit live-operation authorization and perform exactly one recorded exchange:

1. Take the exclusive refresh/checker-selection lock and record the existing check identity and failure counter.
2. Run the trusted refresh container once.
3. Run `claude auth status` in a fresh candidate-only container.
4. Run the root-pinned fixed marker model acceptance in another fresh candidate-only container, with no source, MCP, tools, or prompt variation.
5. Publish only after both candidate checks succeed; otherwise retain the unpublished candidate and journal for diagnosis.
6. Record only generation-changed booleans, fixed outcomes, image/policy identities, timestamps, and the existing run/check ID. Record no token, token-derived digest, credential digest, account identity, or raw CLI/provider output.

The existing two-consecutive-failure history belongs to the original check identity. Renaming the run, changing a label, adding this implementation, or passing synthetic tests does not reset it. Do not rerun either stopped check unchanged. A further live attempt is allowed only under the controller's existing stop/recovery rule and must continue the same counter.

## Completion boundary

Implementation is ready for review when the focused synthetic tests and unchanged ordinary-runtime tests pass, the diff contains only the exact files above, and review confirms the CLI child is the only process that receives the two secret variables. Task 5 refresh acceptance remains open until the separately authorized real exchange, fresh-container status, and fresh-container fixed model marker all succeed. A revoked or unusable credential ends with an explicit user-login requirement; it is not converted into another auth mode.

## Primary references

- Claude Code environment variables: <https://code.claude.com/docs/en/settings#environment-variables>
- Claude Code authentication and credential storage: <https://code.claude.com/docs/en/authentication>
- Claude Code CLI reference for `claude auth status`: <https://code.claude.com/docs/en/cli-reference>
