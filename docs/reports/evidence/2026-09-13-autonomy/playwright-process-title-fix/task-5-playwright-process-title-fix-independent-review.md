# Task 5 — independent process-title/kernel-executable review

**Scoped spec compliance: PASS. Scoped code quality: PASS.** No actionable finding in the frozen two-file correction. This is an offline code/evidence verdict, not actual kernel-executable or browser acceptance.

## Frozen identity and scope

Read the root's `task-5-playwright-process-title-ruling.md`, implementation report, immutable diff, source proof, command metadata and raw RED/GREEN/covering logs. Independently verified report SHA256 `e5d034687e02526dee06cc95d3a09558232d2c60c5e94a758e39bf79c2524abe`; diff `playwright-static/process-title-fix/process-title-only.diff` is 23,960 bytes with SHA256 `de1f0d6ad21134cb68ea1d46701e1c13dca06cd21526882c514c3b7498f2beaa`.

BASE/HEAD remains `139954950e91c530772216975d1c85bce4bbd155`, an uncommitted checkpoint. Trace rejected the execution-worktree outline; the exact immutable diff was read once as fallback. Independent in-memory reconstruction from frozen `.before` files verifies both before/after identities. Canary after SHA256: `4074a327fe72e90aa033816120ed5ae4a5d31f18c67687b78f310f82502b6d86`; test after: `8cf39c36efee6ec33bfb272c0b828b8958d161e98df9d4a93ba76292345e94c6`.

Hash-only checks confirm all eight other release sources unchanged, including `test_runtime.py` pin `3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc`. The accepted snapshot/action/completion helpers, screenshot classifier and namespace/capability threshold block are byte-preserved. No image, launch vector, seccomp, runtime, mapper or package permission changes occur.

## Kernel identity and command interpretation

The collector's `kernelExecutable` at canary line 98 reads the kernel exe link and stats its target. Each browser row captures that evidence at line 126 and rereads it alongside the existing starttime/status/maps/namespace checks and the raw cmdline. The fixed image executable is statted before and after collection. Observed changes or missing/unreadable evidence produce retained errors. Validation at lines 215–222 requires the expected fixed path, a regular target, and matching device/inode for every browser row. No argv-based fallback bypasses a missing, denied, mismatched or deleted kernel executable path.

`browserCommand` at line 173 keeps ordinary NUL-field argv separate from a one-field rewritten title. A title needs the exact binary prefix immediately followed by one anchored known role: zygote, renderer, gpu-process or utility. Unknown/unanchored/multiple role tokens and observed `--no-sandbox` tokens refuse. Legitimate `--no-zygote-sandbox` remains distinct. The parser returns `complete_argv:false` for titles and never shell-parses them; the retained row labels the representation and preserves its raw reported cmdline. It therefore does not claim that a truncated child title exposes all original flags.

Validation additionally requires a normal main-browser argv row at line 224, as well as the existing renderer. Kernel identity does not relax any namespace/capability/NNP/seccomp condition. Child titles support only the bounded role interpretation allowed by the ruling; fixed launch and normal main evidence remain necessary. All collected diagnostics are still persisted at line 246 before policy validation.

## Actual versus synthetic evidence

Independently compared the reconstructed test's `SAVED_PROCESS_ROWS` with the complete saved `playwright-static/canary-6/control/evidence/browser-processes.json`. They are semantically identical; saved SHA256 `7ddbce2dfeff5d6681316487b2d4bcb1451f7554393787c2fcbaefc05cde1da4`. All seven rows match: PID32 has 46 argv fields; the six children have one rewritten title field; renderer PID94 ends at `--ozone-plat`. None of these actual rows contains exe proof.

The test explicitly injects synthetic device/inode evidence into a copied fixture. It cannot establish actual procfs readability or identity retrospectively. Its RED reproduces the old equality rejection of otherwise constrained saved title rows. GREEN passes the focused check; the retained covering run passes 9/9. Raw log hashes and exact command metadata match the frozen proof. Negative cases cover bad prefix/device/inode/path, absent/denied exe, ambiguous/unknown/unanchored role, forbidden flag, missing main and race errors. The real collector is also exercised against a temporary proc-shaped fixture; removing its synthetic exe symlink retains `executable:ENOENT` in persisted diagnostics. No suite was rerun by the reviewer.

## Acceptance boundary

Actual kernel exe readability, per-process identity consistency and remaining browser/security/network/cleanup acceptance remain unknown until a separately released invocation. An actual unreadable nondumpable process must refuse; this review supplies no permission fallback. The bounded rechecks detect observed change, not an atomic procfs snapshot guarantee.

Browser failure count **6** remains preserved. The final package invocation belongs to root after this scoped gate; this report neither starts it nor issues a receipt or browser/native/whole-task acceptance. No browser, Docker, model, auth, native, Multica, network, config, source/index/HEAD mutation, commit or subagent operation occurred. Unrelated accepted components were not reopened.
