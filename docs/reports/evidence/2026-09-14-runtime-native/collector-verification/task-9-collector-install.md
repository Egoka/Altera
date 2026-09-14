# Minimal collector installation and invocation

The native profile remains `native_claude_adapter.py DEPLOYMENT DEPLOYMENT_SHA --` or
`native_codex_adapter.py DEPLOYMENT DEPLOYMENT_SHA --`. Static probes also work through those
fixed arguments. Source modules must remain in sibling `scripts/agent-runtime` and
`scripts/agent-loop` directories when copied. Include gate.py plus the existing runtime,
preparation, credential and provider mapper modules. Each deployment pins their final bytes.

Collector deployment JSON (private file 0600 under a private 0700 directory):

```json
{
  "schema_version": 1,
  "provider": "codex",
  "workspace_id": "ACTUAL-WORKSPACE-UUID",
  "agent_id": "ACTUAL-AGENT-UUID",
  "actor": "ACTUAL-AGENT-UUID",
  "server_url": "https://api.multica.ai",
  "registry": "/ABS/private-collector-registry",
  "source": "/Users/egorbondarenko/WebstormProjects/Altera",
  "modules": {"collector":"SHA", "gate":"SHA", "runtime":"SHA", "adapter":"SHA", "prepare":"SHA"},
  "multica": {"path":"/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica", "sha256":"SHA"},
  "checks": {"runtime-isolation":{"path":"/ABS/check-spec.json", "sha256":"SHA"}},
  "limits": {"cli_seconds":15, "cli_bytes":1048576}
}
```

These two limits and the check limits below are explicit root execution choices. Registry
must be outside source, snapshot, policy and run roots. Different provider/agent pairs may use
separate deployment configs and registries. A consumed invocation remains in `claimed/`;
there is no expiry or background poller. A leftover pair lock requires reconciliation.

Copy `scripts/agent-runtime/runtime-check.test.mjs` into the reviewed base policy before
preparation. It has five actual infrastructure assertions and pins the accepted UID501.
The existing accepted runtime uses host UID501/GID20, not browser-fixture UID1000.
Use this private check spec, with its SHA recorded in the collector config:

```json
{"schema_version":1,"argv":["/usr/local/bin/node","--test","--test-reporter=tap","/runtime/policy/runtime-check.test.mjs"],"cwd":"/Users/egorbondarenko/WebstormProjects/Altera","network":"none","parser":"node-tap","timeout_seconds":120,"maximum_output":1048576}
```

Passport stage names/check IDs are explicit. For example, a verification-only `test` stage
may declare `runtime-isolation`/`AC-1`, followed by a separate `review` stage with its own
check ID in this same catalog. Admit one stage/run at a time. The gate remains responsible
for stage prerequisites and acceptance report schemas.

Private admission request (collector fills all overlapping adapter/gate IDs):

```json
{
  "invocation_id":"FRESH-INVOCATION-ID",
  "native_task_id":null,
  "issue_id":"EXISTING-ISSUE-UUID",
  "passport":"docs/plans/2026-09-14-native-runtime-pilot.gate.json",
  "stage":"test",
  "run":"FRESH-GATE-RUN-ID",
  "allowed_transitions":["bind-artifacts","finish","release"],
  "prepare_request":{
    "schema_version":1,
    "destination":"/ABS/adapter-registry/FRESH-INVOCATION-ID",
    "snapshot":"/ABS/invocations/FRESH-INVOCATION-ID/snapshot",
    "run_root":"/ABS/invocations/FRESH-INVOCATION-ID/run",
    "dirty_paths":["EXPLICIT-UNTRACKED-PATH-IF-ANY"],
    "policy":"/ABS/reviewed-base-policy",
    "image":"sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426",
    "store_manifest":{},
    "provider_input":{},
    "claim":"/ABS/adapter-claims/FRESH-INVOCATION-ID.json",
    "observation":"/ABS/adapter-observations/FRESH-INVOCATION-ID.json"
  }
}
```

All parent directories must already exist and all per-invocation destination/snapshot/run/
provider output directories must be fresh. `dirty_paths` must explicitly name **every**
untracked input accepted by runtime.snapshot (including prior evidence for later runs).
Gate uses its separate scoped `snapshot(root, validated_passport['scope'])` algorithm.
A preparation failure after gate start retains the owned gate slot and launches no child.

For Claude, `store_manifest` is the existing accepted credential-refresh manifest pointing
to an existing private store/generations; credentials remain opaque references.
`provider_input` is `{probe,probe_sha256,source_sha256,build_sha256,output_dir}` for accepted D1.
For Codex, the unused store record can be `{}`; `provider_input` is:

```json
{"probe":"/ABS/accepted-d2","workspace_root":"/ABS/daemon-managed-workspaces","expected_cwd":"/Users/egorbondarenko/WebstormProjects/Altera","expected_uid":501,"base_policy_path":"/ABS/reviewed-base-policy/base.toml","expected_base_sha256":"SHA","output_dir":"/ABS/invocations/FRESH-INVOCATION-ID/policy","mapping_policy_version":"codex-mcp-map-v1","required_servers":["context7","trace"],"auth_file":"/ABS/opaque-auth.json"}
```

D2 is executed freshly with the current native `CODEX_HOME` and exact accepted binary/source/
build pins. No previously prepared D2 descriptor is allowed in the collector production path.
The native daemon supplies task ID at bind; no `MULTICA_RUN_ID` is expected by its actual contract.

```bash
python3 -I scripts/agent-loop/native_collector.py --config /ABS/collector.json --sha256 CONFIG_SHA admit --request /ABS/admission.json
```

Only after admission returns should the controller start the native run with the permanent
profile. The wrapper binds, observes the child, drains its container/provider resources,
checks the exact active native row using the opaque task token, then executes the fixed checks.
It exits without waiting for its own terminal callback. Failed checks or incomplete receipts
return nonzero; they never automatically finish a stage.

Later terminal reconciliation uses the same task-token mode via the CLI when that credential
is still valid, or an **explicitly supplied trusted controller runner** through the importable
`reconcile(config, invocation, multica_runner=runner)` API. The runner receives fixed argv with
`--server-url`, `--workspace-id`, `issue runs ISSUE --output json`. It returns the parsed array.
The wrapper never silently falls back to the owner session. `completed` and `failed` are the
observed terminal mappings; cancelled/unknown remains refused. Pending is one bounded no-op.

```bash
python3 -I scripts/agent-loop/native_collector.py --config /ABS/collector.json --sha256 CONFIG_SHA reconcile --invocation FRESH-INVOCATION-ID
python3 -I scripts/agent-loop/native_collector.py --config /ABS/collector.json --sha256 CONFIG_SHA transition --invocation FRESH-INVOCATION-ID --request /ABS/decision.json
```

A private `decision.json` is `{"operation":"finish","artifact":"docs/reports/PASSPORT-report.gate.json","event_id":null}`.
Prepare and archive the existing gate's paired human/JSON report first, commit only this passport's own artifacts, then call transition with `{"operation":"bind-artifacts","artifact":"docs/plans/PASSPORT.gate.json","event_id":"FRESH-BIND-EVENT"}` before finish. The gate validates artifact-only revision equivalence. Finish requires current passing
proofs and a separately reconciled successful terminal receipt; gate still validates report,
stage prerequisites and artifacts. `{"operation":"release","artifact":null,"event_id":null}`
releases an owned quiescent run without claiming stage completion and preserves counters.

Trusted records are separate: `observations/runtime.json`, `observations/process.json`,
`observations/EVENT.json` check receipt, `journal/EVENT.json` gate record, later
`reconciled/INVOCATION/terminal.json`, and `journal/transition-OPERATION.json` controller decision.
Gate proof/output/trace are in the passport's own `docs/reports/evidence/SLUG/` directory.
Required native artifacts are deliberately empty in this minimal pilot: model-authored files
are not admitted as trusted evidence. The fixed check produces its own output and trace.

`collect` is intentionally an in-process adapter callback only. The standalone CLI accepts no arbitrary adapter/runtime observation paths; host callback observations are the source of process receipts.
