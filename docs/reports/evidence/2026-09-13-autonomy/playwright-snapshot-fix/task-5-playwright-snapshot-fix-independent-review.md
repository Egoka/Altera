# Task 5 — independent offline Playwright snapshot fix review

Spec compliance: **PASS (scoped offline fix)**. Code quality: **PASS (scoped offline fix)**. No actionable findings in the two-file delta.

## Reviewed identity and scope

- BASE/HEAD: `139954950e91c530772216975d1c85bce4bbd155`; this remains an uncommitted checkpoint.
- Implementer report: `task-5-playwright-snapshot-fix-report.md`, SHA256 `d32436fd6079e83d39d8e896d397bb3e0b545b1f27f32569c6e402a87a7bba90`.
- Frozen diff: `playwright-static/snapshot-fix/snapshot-only.diff`, SHA256 `e5c80ef5cfa33a30838254f696375b0def933e1b969c10f18caf134e5919cb7a`, 15,573 bytes.
- Reviewed only `scripts/agent-runtime/playwright-mcp-canary.mjs` and `scripts/agent-runtime/test_playwright_mcp.py`. Trace rejected the execution-worktree outline with SECURITY_VIOLATION; the exact frozen diff was the fallback. The complete diff was read once.

The two post-change sources were independently reconstructed in memory from the frozen `.before` artifacts and unified diff. Their hashes match `source-proof.json`: canary `8fdb109a7baf80cdab9449b41cc2facb5fa2043263afdb41dc6b8228f75be9f3`, test `5469691b9b6d856c0121da9c89ebd1e3bde2fcf5928aa0efee3408d2ae6e9297`. Hash-only checks confirmed all eight other release sources still match that proof. No source was edited or executed for this review.

## Independent assessment

`snapshotObservation` at canary line 23 preserves inline responses and appends a linked snapshot to the original content, retaining URL and title. Its production logical and physical root is `/runtime/evidence/playwright`; the alternate physical root is used only by the explicit offline `snapshot-contract` fixture mode. MCP content cannot select another physical root. Accepted links are one canonical absolute path or the exact relative form from `/source`, to a single bounded `.yml` filename. Ambiguous/multiple links, other roots, encoded paths and URL forms refuse.

The helper bounds response text and leaf size to 1 MiB, requires nonempty regular single-link files, rejects symlink ancestors and leaves, opens with no-follow/nonblocking flags, and checks held/named file and directory identities before and after the bounded read. Invalid UTF-8 and NUL content refuse with the fixed diagnostic. It follows no further links in the loaded YAML. These are bounded diagnostic artifact guards; this review does not claim a new OS security boundary.

The helper is integrated at all four actual page/ref sites: navigation at line 265, Continue click at 267, Name input at 268, and Submit click at 269. Existing page/ref assertions receive the combined response. The screenshot path-denial classifier was independently compared byte-for-byte and is unchanged. The diff leaves the accepted screenshot argument builders, security profile, launch vector and receipt policy untouched.

## Evidence checked

The retained `playwright-static/canary-3/control/evidence/main-protocol.jsonl` response with id 3 equals the test's `SAVED_SNAPSHOT_RESPONSE` semantically. Its linked `playwright/page-2026-09-14T08-44-00-471Z.yml` equals `SAVED_SNAPSHOT_YAML` byte-for-byte; SHA256 is `f04e9fd7f885796009058a2db52cc1bb1eda9a2b0952d1c779c7e14b96be91a5`. This independently corroborates the implementation report's fixture claim.

Read and hash-verified `playwright-static/snapshot-fix/red.log`, `green.log`, `covering.log` and their command metadata. RED fails because the original linked-only text lacks the actual page marker; it is a behavioral regression demonstration. GREEN passes the focused test, and the retained covering run passes 5/5. The added test covers the saved relative response, absolute and inline variants, exact size limit, URL/title/ref preservation, and refusal of missing/escaping/sibling/encoded/multiple links, symlink roots/leaves, hardlinks, oversized/empty/nonregular files and invalid UTF-8. No suite was rerun.

Reviewer artifact reconstruction initially treated the second file header as a deletion because this diff has no `diff --git` separators. One correction to that reviewer-only parser produced both exact expected source hashes. This was an evidence-inspection error, not a product test or browser retry; its failed and corrected outputs remain in the review tool transcript.

## Acceptance limits

This PASS closes only the offline snapshot reader fix. The one-use browser recovery was consumed and FAILED; browser check count **3** remains stopped. This review authorizes no retry, creates no receipt, and does not establish successful browser interaction, screenshot/negative-control completion, native acceptance or whole Task 5 acceptance. No Docker, browser, network, model, native, credential, configuration or Multica operation occurred during review. Prior accepted mapper, static R1/R2 and chroot decisions were not reopened.
