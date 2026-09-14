# Task 8 adapters — independent scoped review

**Spec compliance: NEEDS FIX. Code quality: NEEDS FIX.** The stable entrypoints and shared ticket shape are a useful implementation start, but the production provider/preparation paths are not yet executable under their required contracts. Do not register these entrypoints or treat this task as accepted before the findings below are corrected and verified offline.

## Reviewed identity and limits

Base: `bb7f4d98c5b9bdb9b559358cc5e6801aecbf160b`. Exact frozen `task-8-adapters.diff`: 41,428 bytes, SHA256 `7cdd6c34b3a99cdddb1b9d7d4628ac10c1346ac42f40c33ee876687a15027ce0`. Report as read: SHA256 `0fc1f49cf8c7d03f09b86042cf20ec92d65a1c138afb3aab23dc086a94e69f21`. The seven new files were reconstructed from the diff and their hashes independently match the report/current files. The complete diff was read once in sequential chunks.

Requirements read: Task8 brief, Task9 root rulings, detailed Claude adapter brief, generation-selection readiness and adapter root rulings. Trace outlines/symbols preceded named dependency examinations. Outside the diff, only concrete interfaces needed to resolve findings were examined: runtime effective arguments/command/launch/fingerprint, Store construction/current, mapper output contract, and already archived non-secret D1 descriptors. No implementation, tests, synthetic probes, Docker, native, model, auth/config operation, index/HEAD write or subagent was performed. Collector/gate implementation and prior accepted component internals were not re-reviewed.

## Findings

### R1 — Map the actual Claude managed-config argument, not the Trace descriptor enum (P1)

Location: `scripts/agent-runtime/native_claude_adapter.py:47` (returned `path_map`).

The adapter returns `{trace['command']: '/usr/local/bin/trace-mcp'}`. Accepted D1 emits a diagnostic enum such as `trace_host_name`, not the original managed-config filename. The archived `docs/reports/evidence/2026-09-13-autonomy/d1-native/native-descriptor-proof.json` confirms that exact shape. Existing `runtime.effective_args` instead looks up the actual absolute value of `--mcp-config` and requires a `/runtime/policy/...` destination. A normal daemon invocation therefore fails `managed_path_unresolved` even when D1 succeeds.

Use the finite-arity native argv contract to obtain the one actual managed-config path, validate that invocation with the pinned D1, and map that path to the prepared RO MCP policy file. Keep D1 command enums as diagnostic classifications, not pathname authority. Regression: real accepted D1 on a synthetic private config containing exact Context7/Trace, followed by actual adapter verification and `runtime.command`, must preserve opaque option values and map the real config path; malformed/duplicate config options refuse.

### R2 — Prepare the approved provider network for real model invocations (P1)

Location: `scripts/agent-runtime/prepare_native.py:43` (runtime manifest construction).

The prepared manifest omits `network`, and the strict request schema cannot provide it. Existing runtime defaults that field to `none`; `provider_network` consequently creates no egress proxy and the model cannot reach its provider. Neither provider verifier adds the field. This is a launch blocker for both permanent adapters, not a missing live credential.

Prepare the explicitly authorized `provider-proxy` network and its complete pinned policy inputs for these real provider invocations; do not broaden arbitrary network authority. Regression: actual preparation through each real provider verifier must yield the intended network contract and a valid `runtime.command`; a fixture/unauthorized network request must refuse. No model or Docker run is needed for that regression.

### R3 — Assemble a complete fresh Codex runtime policy generation (P1)

Location: `scripts/agent-runtime/native_codex_adapter.py:31`, and `prepare_native.py:37`.

The verifier replaces the prepared policy directory with the materializer output directory. `materialize` requires that output directory to exist and writes only `codex-config.toml` and `codex-mcp-catalog.json`. Preparation neither creates this generation nor copies/pins the other runtime policy files into it. A fresh bare output directory therefore loses `claude-settings.json` and `protocol-guard.mjs`, both required by `runtime.command`; a nonexistent output directory fails even earlier. A caller could manually preseed files, but that is absent from the implemented preparation contract and its evidence.

Have trusted preparation create and validate the complete new policy generation, preserve required immutable guard/settings/proxy files, and materialize Codex config into that generation before using its final tree hash. Regression: actual prepare→real synthetic D2/TOML materialize→`runtime.command` succeeds with the full policy and refuses changed/missing required policy inputs. Do not substitute mapper-only unit tests for this integration.

### R4 — Reject claims and observations inside model-writable mounts (P1)

Location: `scripts/agent-runtime/native_adapter.py:167` and `:227`.

The deployment only checks that claims/observations are private directories; `run_pending` then accepts ticket paths without comparing them to runtime roots. A configured claims or observations directory can equal or lie under `run_root/cache` or another container RW mount. Runtime later makes those mount roots writable. This violates the required coordinator-only sibling authority and can let model-writable state remove a consumed claim or forge an observation. A mode check at deployment does not establish mount separation.

Before claim/launch, validate canonical claim, observation, registry and trusted metadata destinations against all runtime RW roots and reject overlap; retain that authority outside container mounts. Regression: a ticket with claims or observations at/under cache/tmp/evidence refuses before launch, while valid sibling paths retain one-use behavior on both successful and failed invocation. Keep this within the adapter boundary; no scheduler redesign is needed.

### R5 — Apply bounded metadata admission during registry selection (P2)

Location: `scripts/agent-runtime/native_adapter.py:231`–`:242`, especially `path.read_bytes()` at line235; `_write_observation` at line149.

Registry discovery reads every candidate with unbounded `Path.read_bytes()` before the private/regular-file checks in `_private_json`. A `.json` FIFO blocks selection before any claim or timeout; an oversized file is read completely, and an invalid candidate can be silently skipped when one other candidate is valid. The later bounded helper cannot repair this earlier read. Observation generation also reopens the runtime manifest with unbounded `read_text()` instead of using the already admitted in-memory manifest.

Bound registry enumeration and candidate reads, validate regular-file/owner/mode/size metadata before reading with nonblocking/no-follow admission, and define refusal for malformed candidate authority rather than silently bypassing ambiguity. Pass the validated runtime manifest/run root into observation generation. Regression: FIFO, oversized, unsafe-metadata and malformed eligible candidate cases refuse promptly without reading arbitrary content or launching; a normal single candidate still succeeds. No existing suite rerun is required to design those focused cases.

### R6 — Refuse missing stores before the constructor can provision them (P2)

Location: `scripts/agent-runtime/native_adapter.py:188`.

The adapter constructs `Store` without first requiring its store and generations directories to exist with trusted metadata. The actual constructor creates either missing directory. The governing root ruling explicitly forbids this bootstrap behavior in native preparation/admission. The existing real `Store.current()` validates a published pointer and raises on its absence; the tests' `EmptyStore.current() -> None` is not a realistic successful selection contract and should not be used to demonstrate authenticated admission.

Check the existing store/generations metadata before constructing Store, then require a valid published current generation and close the descriptor/store on all paths. Preserve the five-second whole-run cooperative lock. Regression: absent store or generations causes no directory creation and no launch; a real synthetic published generation selected after preparation is used at invocation; contention remains excluded through synchronous launch and is released afterward.

### R7 — Complete the pinned launch-input authority checks (P2)

Location: `scripts/agent-runtime/native_adapter.py:90`–`:120`, `:222`–`:226`, and `prepare_native.py:42`–`:58`.

The ticket's `gate_input` is copied without checking its revision against the actual prepared source state; passport hash/path are likewise only carried as labels. Stable deployment lacks the authorized source/cwd binding required by the root ruling. Runtime checks source versus its own snapshot, but does not compare the actual native cwd or ticket gate input. Thus a self-consistent snapshot can launch under a stale or different gate-input label. Deployment authority also pins only three new modules; dynamically executed runtime, mapper and credential-refresh modules are not included in the declared code-authority check, despite the detailed brief requiring altered module identities to refuse.

Pin the required dependency identities and fixed authorized source/cwd, and validate the ticket's source/passport/gate input at preparation/admission using the existing exact algorithms. Do not equate unlike dirty-fingerprint algorithms; retain and verify both through the coordinator contract. External four-ID native readback and semantic gate acceptance remain collector-owned. Regression: wrong native cwd/source, stale gate HEAD, passport mismatch and changed execution-module identity each refuse before provider probing/launch; exact matching inputs pass. The observation must not present unchecked input labels as verified source authority.

### R8 — Keep static probes and environment access outside real invocation admission (P2)

Location: `scripts/agent-runtime/native_adapter.py:168`, `:212`, `:252`, and the provider entrypoints.

Neither provider entrypoint handles static `--help`/`--version`. Direct probes return78; probes through the fixed deployment bootstrap enter ticket selection and can consume a real ticket before D1 refusal. This violates the explicit no-manifest/no-claim static-probe contract. Both run functions also copy the whole `os.environ`, including `MULTICA_TOKEN`, although the brief permits reading only declared non-secret integration IDs and forbids reading that token. No model passthrough was found, but unnecessary secret ingestion is still outside the stated boundary.

Recognize the narrowly specified static probes before manifest/registry access, emit truthful fixed metadata, and read only the allowlisted integration-ID/environment-presence fields required for admission. Regression: static calls succeed with nonexistent deployment/registry and leave any pending claim untouched; an environment mapping that rejects access to secret/unrelated keys still permits valid admission and catches unmapped managed-home presence before child work.

## Verification sufficiency and accepted parts

The new test file contains four adapter tests, all replacing provider verification and/or launch with injected functions and using `EmptyStore`; it contains no preparation test and invokes neither production provider verifier. It therefore cannot establish the required real synthetic D1/TOML integration, complete runtime manifest, input-code drift rejection, metadata bounds, full-run generation locking or static entrypoint behavior. The additional Store contention test is relevant, but does not replace adapter lifecycle tests. The report's 44-test claim includes existing refresh/mapper coverage and is not proof of these new paths.

No raw 44-test command/output files were present in the supplied package or the scoped artifact listing at review time. The implementer report is a secondary summary, not raw verification evidence. Preserve any existing raw transcript/path without reconstruction; otherwise mark it absent and retain raw commands/results for the focused corrections. The reported extra D1 PermissionErrors and interrupted broad gate run are not passes and are not product failures attributable to this adapter delta. They do not justify rerunning unrelated suites.

The chosen whole-run `Store.locked(timeout=5)` structure avoids nested lock acquisition, retains the selected fd through synchronous launch and closes it afterward. It is correctly described as cooperative refresh serialization, not hostile-same-UID protection or proof of container quiescence. Observation fields honestly retain unknown raw child exit/signal/container/quiescence, and the adapter does not call gate finish or infer success from model prose. Keep these properties while fixing the concrete blockers. No live/native acceptance or collector completion is granted by this review.
