**R1 — Reject semantically existing MCP tables in the base policy — ADDRESSED.** `scripts/agent-runtime/codex_toml_map.py:612` and `:647` parse a deliberately bounded base key path and reject top-level MCP authority in bare, quoted, whitespace/dotted table, array-table and assignment forms. Unsupported escaped/multiline key syntax refuses rather than falling through. The base digest remains mandatory. The new focused regression covers the original quoted-table bypass and equivalent accepted spellings and requires no publication.

**R2 — Bind the published file to the validated temporary inode and directory — ADDRESSED for the original false-success defect; new Important breakage in the fix is recorded below.** `scripts/agent-runtime/codex_toml_map.py:803` now retains the output directory and temporary fd, links relative to the held directory, compares temporary/held/final identities, and handles link-count transitions. The original same-size temporary replacement no longer returns verified success; its regression confirms refusal, removal of this attempt's published outputs and preservation of the foreign temporary entry. Cleanup at line 775 checks the current entry against the recorded identity. However, the newly introduced final reread has an unsafe ordering that prevents acceptance of this fix round.

**R3 — Make public failures fixed and non-disclosing for malformed values and filesystem errors — ADDRESSED for the reported cases.** `scripts/agent-runtime/codex_toml_map.py:50` now suppresses underlying exception chaining. The trace/Playwright branches validate the command and all argv elements as strings before set membership, so the original array/nested-array inputs produce the fixed unverified result. The focused regression checks the rendered missing-directory exception and both malformed semantic shapes. This is a scoped verdict on the original cases, not a new general audit of all public inputs.

## New Breakage in the Fix Diff

### N1 — Important: Validate the reopened final descriptor before reading it, and open it nonblocking

Location: `scripts/agent-runtime/codex_toml_map.py:860`–`:866`.

The new final reread opens `codex-config.toml` without `O_NONBLOCK`, obtains `fstat`, then calls `_read_published` **before** checking that the opened file matches the validated temporary inode. Replacing the final name just before that reopen can therefore cause the trusted host mapper to read a different file before it rejects the replacement. Replacing it with a FIFO can also block at `open` before any `fstat`/rejection.

The one focused frozen-source probe replaced the final entry with a private synthetic canary immediately before the new reopen. It recorded `foreign_read_bytes: 29`, then `outcome: output_invalid`, with `final_open_nonblocking: false`. Thus the later rejection prevents false publication acceptance but does not preserve metadata/identity-before-content admission. Only synthetic bytes were read; no real secret/config/store was accessed. The FIFO consequence follows from the observed flags and code ordering; a hanging FIFO was not executed.

This is new code introduced by R2's fix, within the original descriptor-bound publication requirement. It is not an attempt to extend the review to unrelated source or to the expressly excluded same-UID mutation after final validation.

Required cause correction: open the final entry using nonblocking/no-follow flags; validate its regular-file/security metadata and identity against the held validated file **before** reading any byte; keep the existing post-read identity/content/named-directory checks. A foreign inode must be refused without a read, and a special file must be refused without blocking. Preserve the existing identity-bound cleanup so the foreign entry is not deleted. Add only focused regressions for those admission-order cases before the controller-authorized recovery verification.

## Out-of-Scope Observations

None added. No broader source review, runtime integration, Playwright artifact work or actual D2 mapping was performed.

## Checks and Evidence

- Reviewed original R1–R3 against the already-read original brief, appended `Fix round 1`, and immutable fix diff. Report SHA-256 is `d01f25eb8a8071a0fddde4bd3d27e86554bb1f9ad5a98e9eca8f774b037ba898`.
- Exact fix base `123d1e6f9c6c5199c8a4fe6bf16b451bfe11a084` → head `ccadb408e22936ad00779778a7bbc5799cb87afa`; diff is 27,758 bytes, SHA-256 `2fd5ef665405080f9cbdedca6dcd1364dbe4c558f5fa07e7bd219fb33a9110e6`. Read it once in chunks. Pre/postcommit evidence agrees on exactly the mapper, its tests and the narrow documentation section, matching blobs/modes and clean owned paths.
- Read actual `task-5-codex-toml-mapping-fix1-green.log`: the three named regressions passed, **3/3**. Read `task-5-codex-toml-mapping-fix1-final.log`: the covering mapper suite passed, **16/16**. The new final-reopen ordering case is not covered by those tests.
- Read retained `task-5-codex-toml-mapping-fix1-hook.log`: normal Prettier/ESLint and workspace tests completed successfully; server **19 passed, 1 todo** (one skipped test file), web **5 passed**. The frozen postcommit record pins the Node24.12 invocation environment; this hook output contains no version warning. The missing original `123d1e6` hook file and its Node24.3 warning remain historical limitations and were not reconstructed or reset.
- Per the report, the original focused RED remains unchanged even though the first base subtest's successful publication caused subsequent `output_exists` cascades; each base variant was isolated before GREEN. No claim is made that the cascaded failures were separate successful reproductions. Standalone focused Prettier raw output remains transcript-only as disclosed by the report.
- One new named-risk examination used only `git show` for the exact committed mapper and a private synthetic publication fixture. Source SHA-256 was checked against `60b9c909076efcad8223a5584442ab357f5a255b4a07df9fc89bd4e4a1ba0ae1`. Script: `task-5-codex-toml-mapping-review/fix1-reopen-probe.py`; sanitized result: `task-5-codex-toml-mapping-review/fix1-reopen-proof.json`. The script's exit0 means observations were recorded, not that mapper acceptance passed. Fixtures were removed after observation.
- No existing test suite was rerun. No source/index/HEAD writes, subagents, actual D2/config/auth/store access, API, Docker/container, MCP/model/native operation or live mapping occurred.

## Verdict

**Spec compliance: NEEDS FIX. Code quality: NEEDS FIX. Fix round: original R1–R3 addressed, but new Important N1 blocks acceptance.**

This is the **second consecutive negative independent review** of the mapper check. Preserve count2 and stop this check; source test success does not reset it. As root has ruled, any continuation must use the existing Task 6 / architecture cause-based recovery procedure after concrete correction and confirmation that no duplicate check is active. No third unchanged re-review, renamed check or automatic reset is authorized by this report.

Historical real mapping remains unexecuted and unaccepted. All separate native/runtime/roster/static-Playwright gates remain unchanged.
