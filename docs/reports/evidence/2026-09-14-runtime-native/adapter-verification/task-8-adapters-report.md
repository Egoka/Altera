# Task 8 — permanent native adapters report

Baseline: `bb7f4d98c5b9bdb9b559358cc5e6801aecbf160b` on
`docs/agent-loop-autonomy`. Owner `pnpm-lock.yaml` and concurrent runtime evidence/status files
were not edited. No Docker, model, native daemon, network, profile, credential, or live-store
operation was performed.

## Result

Implemented stable Claude/Codex entrypoints, shared per-invocation preparation, strict registry
selection, external ticket digest verification, atomic one-use claims, native-ID late binding,
Claude D1 verification, Codex managed-TOML materialization, opaque Codex auth reference validation,
and truthful observations. `runtime.py` was not changed.

The pending ticket binds issue, agent, workspace, passport path/hash, gate task/stage/run/lease,
revision/dirty fingerprint, check IDs, criteria, event IDs, runtime/store manifests, provider input,
claim and observation. `native_task_id` may be `null`; the adapter binds it exactly once from
`MULTICA_TASK_ID` in the claim. A prebound value must match. Ticket SHA-256 is external and is
recorded in claim/observation rather than placed self-referentially in ticket bytes.

Claude selection holds the cooperative store's exclusive `refresh.lock` across synchronous
`runtime.launch`, with a five-second admission timeout. The open credential fd is not described as
a lease. Codex `auth.json` is checked only as an opaque regular0600 UID/nlink/size reference; its
content and digest are not read. Missing or multiple eligible tickets refuse before launch.

Observations contain returned runtime status and trusted bindings. Raw child exit, signal,
container ID and quiescence remain `null`/`unknown`; evidence filenames are explicitly untrusted.
The optional outcome callback is host-only and never enters native argv/model environment. Gate
record/finish/release and Multica active/terminal readback remain collector-owned.

## Stable deployment and invocation

Sanitized deployment config (private mode0600 in a private0700 parent):

```json
{"schema_version":1,"provider":"claude","actor":"reviewer-claude","agent_id":"reviewer-claude","workspace_id":"altera","registry":"/ABS/native/claude/registry","claims":"/ABS/native/claude/claims","observations":"/ABS/native/claude/observations","authority":{"native_adapter_sha256":"041e09afa68568daba07e51c16d7f1023593efa7cefaac0a7cc5538d8095cefc","provider_adapter_sha256":"00e7affda118e253fb795551ece2621b8844454eceae4b6d7c2e31e0c882c76d","prepare_native_sha256":"f108551cc4b10558dab322e7de49e000ceba394c78fef59956edbc72b98d38a4"}}
```

For Codex use its actor/agent/paths and provider adapter SHA
`d2694a130909b7562b3c5e4dc82633ce363b7f9b6fb74c2d129469542595e618`.
The deployment config pins stable code and registry authority. Fresh source HEAD/state, policy,
image, D1/D2 descriptor and invocation bindings belong to each pending ticket.

Coordinator preparation, after writing a strict private request JSON and external digest:

```bash
/usr/bin/python3 -I /ABS/scripts/agent-runtime/prepare_native_claude.py /ABS/request.json REQUEST_SHA256 /ABS/native/claude/registry/INVOCATION_ID
/usr/bin/python3 -I /ABS/scripts/agent-runtime/prepare_native_codex.py /ABS/request.json REQUEST_SHA256 /ABS/native/codex/registry/INVOCATION_ID
```

Each command creates `pending.json`, separate `runtime.json`/`store.json`, a new snapshot and a new
run root. Request pins exact runtime image, source/policy, external passport/gate input, store
manifest and provider input. Claude provider input pins D1 binary/source/build SHA. Codex provider
input carries the accepted D2 record, mapper policy version, exact base-policy hash, fresh output
generation and opaque absolute `auth_file`.

Stable profile bootstrap fixed argv (deployment SHA changes only when deployment config changes):

```bash
#!/bin/sh
exec /usr/bin/python3 -I /ABS/scripts/agent-runtime/native_claude_adapter.py /ABS/deployment-claude.json DEPLOYMENT_SHA256 -- "$@"
```

Codex substitutes `native_codex_adapter.py` and its deployment config/digest. The bootstrap must be
private, fixed, safely quoted and installed by root; this task did not install it.

The source snapshot preserves the real root `CLAUDE.md` (3025 bytes) and `AGENTS.md` (3141 bytes).
Managed Codex `AGENTS` context and native protocol instruction injection are not established by TOML
mapping alone; the collector/live acceptance must verify both before native acceptance.

## Verification

RED was observed first: missing `native_adapter.py` caused 3 errors; bounded selection rejected the
new `timeout` argument. After implementation:

```text
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest scripts/agent-runtime/test_native_adapter.py scripts/agent-runtime/test_credential_refresh.py scripts/agent-runtime/test_codex_toml_map.py -v
Ran 44 tests in 0.814s — OK
git diff --check — exit 0
```

An additional 64-test run including D1 tests produced 62 passes and two sandbox-only errors:
the managed environment denied creation of a Unix socket and loopback listener (`PermissionError`).
No code assertion failed. A broad agent-loop gate run was stopped on root direction after numerous
unchanged lifecycle cases passed; it exited 130 and is not claimed as completed evidence.

## Owned source hashes

```text
041e09afa68568daba07e51c16d7f1023593efa7cefaac0a7cc5538d8095cefc  native_adapter.py
00e7affda118e253fb795551ece2621b8844454eceae4b6d7c2e31e0c882c76d  native_claude_adapter.py
d2694a130909b7562b3c5e4dc82633ce363b7f9b6fb74c2d129469542595e618  native_codex_adapter.py
f108551cc4b10558dab322e7de49e000ceba394c78fef59956edbc72b98d38a4  prepare_native.py
94414669626a57894e79ca06643201b6cd4ac55b45d6c9e9432555bcd07cdc5c  prepare_native_claude.py
8e76fbff0cdcec7fb101872346cb814a492221cdb369b0286b52d309f6408913  prepare_native_codex.py
cc437c0b5bf035d5d10cd0f2dba57f3cdbd24c19f620b50679a0b9fae101921d  test_native_adapter.py
17c292b66624d2172c6b2b7f24775ea31d8aa6bbfd5f2103b49aa9dd8552c66f  credential_refresh.py
e7c321ff98eaa43a38d601baaf4791198cdf7257218cd0b12bfb65fe5566b833  test_credential_refresh.py
8ee2bba504ec52d8b173802c100ac638c241726ff08d2bf9db6eb53595b4ad4a  runtime-isolation.md
```

Same-UID replacement between checks remains outside this trust boundary. Live context/MCP/protocol,
native task readback, exact process/container outcome and terminal reconciliation remain pending.
