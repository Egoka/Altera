**N1 — Validate the reopened final descriptor before reading it, and open it nonblocking — ADDRESSED.** `scripts/agent-runtime/codex_toml_map.py:860` now opens with `O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK`. Before `_read_published`, it requires regular-file type, expected UID, exact mode0600, one link and exact expected size, binds the reopened inode to `linked_inode`, and compares full metadata with the still-held validated temporary fd. A substituted regular file or FIFO is rejected before content access.

**New breakage in fix2: None found.** Existing named-entry, directory, content-equality and post-read checks remain; the fix additionally compares post-read metadata with the held fd. Identity-bound cleanup remains unchanged and preserves substituted foreign entries. Original R1–R3 stay addressed and were not re-reviewed.

**Scoped spec verdict: PASS. Scoped quality verdict: PASS. Cause-based recovery: PASS.** This verdict applies only to the N1 correction and new breakage in the exact two-file fix.

## Authority, identity and evidence

- Consumed the one authorized recovery of `task5-codex-toml-independent-review`, attempt `d28e1584897d4abcb19b93bdeb4199bd`, from `task-5-codex-toml-mapping-review-recovery-authorization.json`. Count2 was retained through source correction/testing; root recorded cause correction and absence of an active duplicate before dispatch.
- Base `ccadb408e22936ad00779778a7bbc5799cb87afa` → head `9ed8b88c11d802c6f9b5d89b89eeccff2e1bda1b`. Read the appended fix2 report and frozen pre/postcommit records. The immutable diff was read once: 6,332 bytes, SHA-256 `c58be0b4e1a28656562b7f983946c1a551a86073d417fca4774c39f9e6746b11`. It changes only the mapper's final-reopen admission and its two focused tests. Frozen source identities and committed scope agree; owned paths are recorded clean.
- Read actual `task-5-codex-toml-mapping-fix2-green.log`: **2/2 passed**, SHA-256 `3ae4c428ef2a36262c7985594ad4e0ce0a7102e95909c3f0300b23fe1301f426`. The diff's tests require zero reads from a substituted regular file, nonblocking FIFO open with zero reads, fixed refusal, and preservation of both foreign entries. The FIFO test prevents a hang on the unfixed flags, but the corrected branch delegates its nonblocking open to the real OS operation.
- Read actual `task-5-codex-toml-mapping-fix2-final.log`: **18/18 passed**, SHA-256 `82c5dca45730adf588861f4b5588f590efe177c7db0c32ac8779395a6c1aeb69`. Existing publication/replacement, redaction, semantic-base and mapping regressions remain covered.
- Read actual `task-5-codex-toml-mapping-fix2-hook.log`: Prettier/ESLint passed; server **19 passed, 1 todo**, web **5 passed**, normal commit completed. Its SHA-256 is `7c8d7b555d6e409a183a06cb3e8c0163c8fae86e1d8d5c943194f1fcddba4436`; the frozen postcommit record binds the pinned Node24.12 invocation environment. The original Node24.3 warning/missing original hook artifact remain historical evidence limitations, not rewritten history.

No test, probe or suite was rerun during this recovery review: the retained evidence answers the precise cause. No source/index/HEAD mutation, subagent, actual D2/config/auth/store read, native/API/model/MCP operation or Docker/container action occurred.

## Counter and acceptance boundary

This actual passing independent recovery verdict resets **only** the consecutive failure counter for `task5-codex-toml-independent-review` from 2 to **0**, under the recorded one-use authority. Preserve both prior negative reviews, their causes and this recovery attempt in history. Root remains responsible for the ledger update; no other stopped check is reset.

No out-of-scope observations were added. Historical real mapping and native/runtime/roster/static-Playwright acceptance are separate and are not claimed by this result.
