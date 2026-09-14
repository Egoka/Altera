# Task 9 minimal collector implementation

Implementation frozen for the root combined review and live acceptance. No live native/model/auth/profile operation or commit was performed by this writer. pnpm-lock.yaml was untouched.

Six operations are implemented in scripts/agent-loop/native_collector.py, using the existing gate CLI/state machine and adapter preparation. Admission precedes ticket publication; binding consumes one exact pair ticket; collection requires trusted quiescence/source/policy observations and exact active native identity. Fixed commands produce actual TAP counts and gate proofs. Reconciliation is a later bounded controller action; finish remains explicit.

Runtime launch keeps its integer API/protocol streams and gains an optional trusted observer. Raw client wait, signal proof, exact container inspection/removal/absence, provider cleanup and post-run validation are separate facts. runtime.check uses fixed Node argv and accepted isolation, captures bounded output and rejects skipped-only/zero/truncated checks. runtime-check.test.mjs contains the five real infrastructure assertions requested by root (UID501).

Adapter integration uses only an optional collector reference in the existing pending envelope. Fresh Codex D2 observes current CODEX_HOME with no task token in that child; the actual daemon contract does not require MULTICA_RUN_ID. Native managed home bindings are carried into the runtime manifest. Prepared policy is checked before materialization. Runtime/store/passport/deployment/collector references are checked against RW mounts; observations use bounded manifest reads. Registry iteration is capped and malformed entries fail. Static help/version also bypass admission through stable fixed profile arguments.

Focused verification: 47 tests passed, all commands exited 0. Real temporary Git repositories, gate subprocesses, registry files, actual Node subprocesses and production runtime.check were exercised; Docker/model/Multica boundaries remain synthetic. Tests cover positive admit/claim/check/record, lost record response without repeat execution, failure count retained across runs and second-stop before another child, native mismatch/duplicate/missing token, missing process receipt/model-prose rejection, zero count and output cap, raw negative wait versus ordinary137, unknown/live owned cleanup, policy drift, metadata RW overlap, static probes and fresh D2 environment isolation.

Commands (executed from repository root with PYTHONDONTWRITEBYTECODE=1):

```bash
python3 -m unittest discover -s scripts/agent-loop -p test_native_collector.py -v
python3 -m unittest discover -s scripts/agent-runtime -p test_runtime.py -v
python3 -m unittest discover -s scripts/agent-runtime -p test_native_adapter.py -v
git diff --check
```

Exact raw logs (absolute paths and SHA256):

- /Users/egorbondarenko/WebstormProjects/Altera/.superpowers/sdd/2026-09-13-autonomy-execution/task-9-collector-green.log — 1da513a2da63a261667d2e0cad2ce21752cc0c8f86e357f3ef0ce7462d1d84da

- /Users/egorbondarenko/WebstormProjects/Altera/.superpowers/sdd/2026-09-13-autonomy-execution/task-9-runtime-green.log — 784123bc3da212dcf9b53232d0b2ea2cfaf9ac2010fc839d1b2b7ddfb9baf527

- /Users/egorbondarenko/WebstormProjects/Altera/.superpowers/sdd/2026-09-13-autonomy-execution/task-9-adapter-green.log — 75b94b4168e09b64dcd919636d5b385e5be31e9bbba160d408c2081757887d19

- /Users/egorbondarenko/WebstormProjects/Altera/.superpowers/sdd/2026-09-13-autonomy-execution/task-9-diff-check.log — e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855


Original RED and intermediate raw logs remain in this directory (`task-9-collector-red.log`, `task-9-runtime-red.log`, `task-9-*-check*.log`); no missing output was reconstructed. Runtime check3 failed because Node counts an empty test file as one test; the fixture was corrected to an explicitly skipped test and the final actual parser check passed.

Exact frozen code hashes: task-9-frozen-modules.json. Concrete deployment/admit/check/terminal/transition CLI and private JSON examples: task-9-collector-install.md (part of this handoff).

Limits: current minimal pilot deliberately declares no model-authored artifacts as trusted evidence. Active collection uses task-token authority only; later reconciliation may use an explicitly injected trusted owner runner, never an implicit wrapper fallback. Known terminal mappings completed/failed come from root deployed readback; cancellation/unknown classification stays closed. No scheduler, polling daemon, gate semantics change or automatic substantive acceptance was added. Full publication/recovery/crash matrices remain out of scope as directed. Root still owns independent combined review, final installation pins, exact-image no-model observer canary and actual Codex/Claude native pilot acceptance.

## Final scoped review corrections

Two collector-only findings were reproduced and fixed. Declared bind-artifacts/finish transitions keep exact slot/passport ownership while delegating artifact-only revision equivalence to the existing gate. Admission/collection/check remain strict. A real-gate regression now completes record → paired archive → own-artifact commit → bind → finish. Standalone collect CLI was removed: arbitrary private observation paths cannot mint process receipts; collect remains a trusted in-process callback. Forged RW observation path is rejected by argument parsing before config/read/check/record.

Final collector suite: 9 tests passed, exit0, including both regressions; raw output /Users/egorbondarenko/WebstormProjects/Altera/.superpowers/sdd/2026-09-13-autonomy-execution/task-9-finalfix-green.log SHA256 fb92ad1d5e8ce0ee62d90097d637bc5e08df3b1dd1baaae919d5a0cb44226daa. Preserved RED: task-9-finish-red.log and task-9-cli-collect-red.log. git diff --check exit0. Prior runtime29 and adapter11 results remain valid: neither runtime nor adapters changed in this fix wave. Total affected tests now49. Frozen hashes file updated. Root independently reports actual-image observer/check5/5; this writer did not execute that live canary.
