# Task 6 fix round 1: retained-counter corruption

Status: DONE — Important review finding fixed and committed; independent re-review pending.

## Review finding and scope

First independent Task6 review: Needs fixes, `task6-independent-review` failure 1. The Important
finding is accepted after source inspection and an actual pre-fix reproduction: `read_state`
validated only present counters; `lifecycle_start` could recreate a deleted stopped counter at zero.

Worktree `/private/tmp/altera-agent-loop-autonomy`, fix base
`5bbd693267f4d591391413e77578f5cd434a713b`. That base includes the controller's disjoint archival
commit following `e6f8684`. Only `scripts/agent-loop/gate.py` and `scripts/agent-loop/test_gate.py`
change in this round. Existing lifecycle prose does not need changing: this fixes the already
specified fail-closed behavior. No Task3 check, product/browser/auth fix, original-checkout/state
mutation, or deferred Minor remedy-reuse fixture expansion was performed. No children dispatched.

Applied receiving-code-review/systematic-debugging and existing TDD/verification skills. Trace
outlines again returned NOT_FOUND; only known worktree symbols were read immediately before edit.

## Change

Added `validate_retained_counters`, called by shared `read_state` after task layout validation:

- Every retained check event must still have its task/stage/check counter; missing a stage's entire
  counter map also rejects. This check covers both lifecycle and legacy verification profiles.
- Lifecycle retained check events must appear in the task's ordered history. The latest event for
  each stable stage/check is selected from that order, not the JSON object's sorted key order.
- Current lifecycle failures and stop_event must match that latest retained check event. A counter
  without any retained execution may only be initial zero with no stop reference.
- Existing initial counter creation remains legitimate for never-executed checks. No counters,
  histories, event identifiers, state version or retry allowance are reset or migrated.

Added one integration fixture which first creates a real two-failure stop in a disposable
Git/process fixture. It separately deletes the check counter, deletes its stage counter map,
lowers its count to zero, or substitutes its stop_event; each damaged state is passed to both
`status` and ordinary `start`. All rejected transitions must leave exact original damaged bytes
unchanged. No resumed source check is executed by this probe.

Original 45 fixtures/helpers were mechanically reconstructed by removing only the new test method
and compared byte-exact to base. They are unchanged. Root's unrelated report edits remain outside scope.

## Evidence and actual commands

Python 3.9.6. All unittest processes use `PYTHONDONTWRITEBYTECODE=1`. Unlike the initial Task6
wrapper, each fix1 invocation saves and propagates the actual unittest return code alongside the raw
output. Evidence files are in this report's scratch directory.

1. Expected RED, declared before implementation:
   `/usr/bin/python3 -m unittest discover -s scripts/agent-loop -p test_gate.py -k retained_stop_rejects -v`
   — 1 test, 8 subcases, 7 failures, 9.553s, actual exit 1. Missing/lowered counter corruptions were
   accepted by both status/start; the wrong-stop variant was accepted by status while start already
   refused its still-present count two. Raw `task6-fix1-red.txt`; exact pre-RED file hashes and HEAD
   in `task6-fix1-red-precheck.json`, command/exit in `task6-fix1-red-exit.json`.
2. Same focused command after minimal fix: 1 test/all 8 subcases pass, 7.399s, actual exit 0.
   Raw `task6-fix1-green.txt`, actual precheck `task6-fix1-green-precheck.json`, command/exit
   `task6-fix1-green-exit.json`.
3. Full shared-read_state regression:
   `/usr/bin/python3 -m unittest discover -s scripts/agent-loop -p test_gate.py -v`
   — 46/46 passed, 188.019s, actual exit 0; raw `task6-fix1-full-green.txt`, command/exit
   `task6-fix1-full-exit.json`. Exact owned hashes, HEAD, gate scoped dirty fingerprint and original-fixture
   preservation check in `task6-fix1-full-precheck.json`; exact diff in matching `.patch`.

No actual failed implementation check has occurred in this round. The pre-implementation negative
characterization is retained as RED, not a retrospectively relabeled fix failure. The independent
review count remains one negative review until the controller runs the separate next review.

## Self-review and limits

The fix rejects corruption before status can expose an apparently valid state or start can acquire
a slot and initialize a missing counter. All rejected checks are read-only with respect to retained
state. Successful normal flows, recovery, RED counter semantics, first-time check initialization,
legacy verification fixtures and original prerequisite/parent bypass fixes are covered by full
regression. This is structural consistency against retained history, not protection against a
writer forging every part of state/gate/evidence together. The existing cooperative/runtime limits
are unchanged. Independent Task6 acceptance is pending; the implementation does not self-accept.


## Commit, verification and outcomes

- Commit: `2c33e85fe025e014fd1185619e89159ccecd534b` — `fix(agent-loop): reject lost retained check counters`.
- Tree: `c062bb669e2d19d59d569584397f6bd07450b8b2`; parent `5bbd693267f4d591391413e77578f5cd434a713b`.
- Exactly gate.py/test_gate.py committed; owned scope clean and index empty after commit.
- Precommit and staged snapshots/index/patch are `task6-fix1-precommit.json`,
  `task6-fix1-staged.json`, `task6-fix1-staged.patch`. Postcommit blob/hash equality and full
  SHA/tree are `task6-fix1-postcommit.json`. Checked source was the parent plus owned dirty
  fingerprint and file hashes, not the later commit SHA. Every committed blob matches those
  actually checked file hashes; staging changed representation, not bytes.
- Normal hooks passed under Node v24.12.0: format, lint, project tests and commit-message hook.
  Commit command actual exit 0, raw `task6-fix1-commit.txt`. Project results remain web5 passed,
  server19 passed/1 todo/1 skipped test file; skipped/todo are not accepted coverage.
- `git diff --check` and staged diff check passed. The full46 gate output is pristine.
- Native fix/check/commit completed; implementation fix complete. Independent Task6 acceptance
  remains not_checked pending the controller's re-review. No counters/review history were reset.
- Minor remedy-reuse fixture expansion remains deferred exactly as directed. Initial durable
  Task6 report/evidence were not edited. The scratch task-6-report.md receives only this round
  append; its original prefix hash is retained in the postcommit manifest.
