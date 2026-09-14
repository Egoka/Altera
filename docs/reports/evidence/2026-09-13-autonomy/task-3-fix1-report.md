# Task 3 fix round 1 — implementer report

- **Status:** `DONE_WITH_CONCERNS`, ready for independent re-review.
- **Review input:** `.superpowers/sdd/2026-09-13-autonomy-execution/task-3-review.md` read in full.
- **Review baseline:** `b8e00f13b53cd73db8571d248e6823165d5f3764`.
- **Current disjoint-docs HEAD before commit:** `2d17915740cbefcb535c76e0b67e701b918b04fc`.
- **Fix commit:** `1dad64f9fa0af196e32dd2f9f5676740c8d13797` (tree `01fd47ab9632e845eede697a1d1260ee58cc634e`).
- **Scope:** five Playwright files only. No product/config repair, no database, mail, destructive flow, or external service.
- **Stopped check:** `task3-web-typecheck` remains stopped at two failures and was not run or renamed.

## Scoped snapshots before checks and commit

1. Before any fix-round check, `task-3-fix1-precheck-snapshot.json` captured all five edited-file hashes and the binary patch against `b8e00f1`; its observed HEAD was concurrent-docs commit `19ffb9619c3c6151848ccab02074b760bcddf43a`. `task-3-fix1-precheck.patch` SHA-256 is `e048811ecf92ef4ff94881c19f700c92739fdec0d71e75fca6c72c2d1a81d692`, 10,648 bytes.
2. After root finished its disjoint docs work and before staging/commit, `task-3-fix1-precommit-snapshot.json` captured current HEAD `2d17915740cbefcb535c76e0b67e701b918b04fc`, an empty index, the same five hashes, and the same scoped patch hash/size. The patch is saved as `task-3-fix1-precommit.patch`.
3. `task-3-fix1-staged-snapshot.json` captured the exact five staged paths, staged/worktree byte equality, the same five hashes, and the same patch SHA-256 immediately before the commit hook. Its raw patch is `task-3-fix1-staged.patch`.

The browser RED ran while HEAD was `19ffb9619c3c6151848ccab02074b760bcddf43a`; root then added disjoint evidence commit `2d17915740cbefcb535c76e0b67e701b918b04fc`. `task-3-fix1-disjoint-head-advance.txt` records `git diff --name-only 19ffb9..2d1791`: all eight changed paths are under `docs/reports/evidence/`. A scoped comparison across `web`, `server`, package manifests, lockfile, `.nvmrc`, and workflow reports `CHECKED_INPUTS_EQUAL: true` (chunk `8c9e9b`, exit `0`). The browser run was therefore not repeated for an artifact-only HEAD advance.

Scope hashes in both snapshots:

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `web/tests/e2e/homepage.smoke.spec.ts` | `331e11bf59657378f1629d513c5a1c15b0904c5858034cd1054bc47f7c93c262` | 321 |
| `web/tests/e2e/05-manual-moderation.spec.ts` | `479f4e559ce0aa9284d14ee43294a89a456e6a4afd5691599ce9a366f15c6a41` | 3,182 |
| `web/tests/e2e/11-admin-archive-account.spec.ts` | `e5554990ec2bb4e6a8cef0e9fb934c7a305fb72d4122b5402ebe2ded59f26195` | 2,825 |
| `web/tests/e2e/12-self-archive-export.spec.ts` | `90d89833b63e52403346122239745510f005a4aec9fa948f7fbd644b1b2aa304` | 1,954 |
| `web/tests/e2e/16-permanent-delete.spec.ts` | `b9138968b8b7f691b3c67383359aef21071bd597ba67477256598fec02cbe720` | 3,494 |

## Review findings

### Important 1 — actual document title

Addressed in the test specification: the executed homepage smoke now uses `expect(page).toHaveTitle("Altera")` after verifying `/` and the accessible brand. It does not use `test.fail`, `fixme`, an empty-title expectation, or a product change.

The required check is honestly red on the existing product:

- `check_id`: `task3-fix1-browser-title`
- command: `PATH=/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin:$PATH pnpm --filter nuxt-app run test:e2e`
- started: `2026-09-13T20:26:57+03:00`
- observed HEAD: `19ffb9619c3c6151848ccab02074b760bcddf43a`
- exit: `1`
- executed: `1 failed`, `9 skipped`
- expected/received: title `"Altera"` / `""`
- raw stdout/stderr: `task-3-fix1-browser-title-red.txt`
- tool result: chunk `fceaf5`, wall time `15.030888583s`

T-002 AC3 remains open. The RED is the expected baseline exposure, not a failed product-fix attempt.

### Important 2 — T-112 omissions

Addressed under each existing early `test.skip` without executing destructive/product actions:

- Flow #5 now prepares the author reading the decision, replying, resolving a note, editing, resubmitting directly to `review` without another AI pass, and the reviewer seeing the reply/history.
- Flow #11 now prepares visible session revocation, article archival and public 410, an explicit appeal decision with reason, account restoration while articles remain archived, and one-by-one article restore to `published`.
- Flow #12 now prepares revoked-session redirect, article 410 after self-archive, limited login, account-only restoration with articles still archived, and one-by-one restore.
- Flow #16 now prepares non-owner and active-entity action absence, archived owner precondition, separate exact-name validation, linked-category and last-owner conflict branches, permanent deletion/audit/404, and both slug and handle reservation.

The focused browser run safely discovered all nine skipped scenarios before the homepage title failure. No skipped action ran.

### Important 3 — evidence provenance

The original Task 3 gaps remain unchanged: raw SDL RED, the two stopped typecheck outputs, and the initial browser RED are unavailable. This fix round does not reconstruct them. It adds real raw output and pre-check/pre-commit scoped snapshots only for the newly authorized change.

## Focused checks

| check_id | Command | Exit/result | Raw output |
| --- | --- | --- | --- |
| `task3-fix1-browser-title` | `pnpm --filter nuxt-app run test:e2e` | `1`; expected title RED, 1 failed + 9 skipped | `task-3-fix1-browser-title-red.txt` |
| `task3-fix1-format` | targeted `prettier --check` on five files | `0`, passed | `task-3-fix1-format.txt`; chunk `46dd07`, `0.519071042s` |
| `task3-fix1-lint` | targeted `eslint` on five files | `0`, passed | `task-3-fix1-lint.txt`; chunk `1a0922`, `1.123898416s` |
| `task3-fix1-precommit` | `git commit -m 'test(e2e): address infrastructure review findings'` | `0`; hook format/lint passed, 24 tests passed + 1 todo | `task-3-fix1-precommit.txt`; chunk `76341a`, `4.13618325s` |

Both passing checks used Node `v24.12.0` and pnpm `10.18.3`; the raw files include exact command, time, HEAD, versions, stdout/stderr, and exit code.

## Remaining findings and limitations

- T-001 AC2 and aggregate CI remain open because the unchanged deterministic typecheck fails on nine baseline product diagnostics.
- T-002 AC2 remains open because the public live SDL exposes `email` and `role`; its final test remains a T-027 todo.
- T-002 AC3 remains open because the actual homepage document title is empty; the new assertion exposes it.
- The optional `sharp` build warning remains outside this focused test-specification fix.
- The flow #15 media assertion remains unchanged. Its source says media access closes but does not define an exact response status, so changing `ok() === false` to a guessed 404/410 would invent a contract.
- T-112 flows remain prepared/skipped specifications rather than executed coverage.

## Commit and final identity

The commit hook ran with explicit Node `v24.12.0` and pnpm `10.18.3`; `task-3-fix1-precommit.txt` contains its exact command, start time `2026-09-13T20:30:32+03:00`, pre-commit HEAD `2d17915740cbefcb535c76e0b67e701b918b04fc`, five staged paths, stdout/stderr, exit `0`, and resulting short SHA.

`task-3-fix1-final-manifest.json` records the full commit `1dad64f9fa0af196e32dd2f9f5676740c8d13797`, parent `2d17915740cbefcb535c76e0b67e701b918b04fc`, tree `01fd47ab9632e845eede697a1d1260ee58cc634e`, and exactly five changed paths. Every committed SHA-256 equals the current worktree SHA-256; `all_commit_equal_worktree` is true, the index is clean, and scoped diff exit is `0`.
