# Task 8 fix round 1

Review baseline is the cumulative diff SHA `7cdd6c34b3a99cdddb1b9d7d4628ac10c1346ac42f40c33ee876687a15027ce0`.

Implemented the R1–R8 launch-path corrections: the real Claude `--mcp-config` value maps to the
prepared `claude-mcp.json`; preparation fixes `provider-proxy` and builds a fresh complete provider
policy generation; trusted registry/claim/observation paths are checked against runtime RW mounts;
registry reads are bounded/no-follow and malformed entries refuse; Claude store/generations must
already exist before provider probing or Store construction; passport, gate HEAD, authorized cwd,
source and runtime/mapper/refresh module identities are checked; static probes bypass deployment,
environment and claims; environment admission reads only allowlisted IDs and managed-home presence.

Final affected command raw output is `task-8-fix-green.log`, SHA-256
`0aea198038711c56f56d2845ae91ebc6a64f48f33e3fba5dc3410613edeeb7c8`: 45 tests, exit 0.
`git diff --check` also exited 0. Original round raw logs were absent and were not reconstructed.

Current immutable deployment module hashes are:

```text
native_adapter.py cb61a1ada74596f8ed663b7f382e558102cbebc5ed30da4c1c7cd85dc9a4362a
native_claude_adapter.py e02a1258cc06b4fc4203b202bb84ec9f8f4d12966265cfbd2095f0d28bb21cf8
native_codex_adapter.py 01331a80f7138ade4eef988b9f448b56df87d5df33bd9818fae8bcdbce8547f7
prepare_native.py 9d51915d9fff2a4749168ffef9a741e3fd6906074937e5235f4c0151299f55a1
```

The complete strict Claude preparation request is `task-8-install-request-example.json`, SHA-256
`cd706e287ec7b19025b04df9be197b1da10a9dd81e0848ab5af156f0ddaa5b31`.

The two production-chain regressions are now present. The Claude case creates a synthetic Git source
and reviewed policy, builds and runs the real D1 against an exact private Context7/Trace config,
calls real `prepare_native.prepare` and `native_claude_adapter.verify`, then validates the result with
real `runtime.command`. The Codex case creates a synthetic D2 managed home/TOML, calls the real
preparer, mapper-backed verifier and `runtime.command`, and checks that the full generated policy
retains `protocol-guard.mjs`. Only Docker/model execution is outside these tests.

Final covering raw output is `task-8-fix-green2.log`, SHA-256
`cd6ba6823210743608fb8ad1cab4cae4b79a67ef332601173aee2a8f45c12d84`: 47 tests, exit 0.
The final `test_native_adapter.py` SHA-256 is
`0ac014f4ddee1e04231351d980042ffb02b1e3f3cea3fdf5a78d480c1c7139dd`.

Gate dirty fingerprint remains carried separately and is not compared with runtime's different
fingerprint algorithm. Its producer check uses `gate.snapshot` in the collector-owned boundary, as
ruled by root; no duplicate algorithm was added here.
