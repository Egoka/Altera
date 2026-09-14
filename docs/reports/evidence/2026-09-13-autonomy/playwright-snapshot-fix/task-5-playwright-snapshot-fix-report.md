# Playwright linked-snapshot offline fix

Base/HEAD `139954950e91c530772216975d1c85bce4bbd155`; prior state is accepted staticfix1 plus accepted candidate seccomp pin. Exactly two owned files changed: canary JavaScript and its static Python test. No source/index/HEAD mutations outside these files, staging/commit, Docker/browser/models/auth/native/Multica, dependency, image/security/vector or receipt operation. Same browser failure count remains3; the one recovery authorization is consumed.

## Behavior

`snapshotObservation` preserves the full original MCP response and appends the actual snapshot text. Inline responses are unchanged. It is used at all four actual page-producing navigation/Continue-click/type/Submit-click call sites before marker or accessible-reference assertions. URL/title remain available together with snapshot content. Screenshot request builders and error classifier remain byte-identical.

Only one exact Markdown Snapshot link is supported. The pathname must be the canonical absolute `/runtime/evidence/playwright/<single .yml filename>` or its exact relative spelling from known `/source` cwd, as observed in responseid3. Lexical escapes, subdirectories, sibling roots, encoded/URL/ambiguous links are refused. Filesystem resolution never follows a response-selected root. Production root is fixed `/runtime/evidence/playwright`; an explicit physical root exists only for the offline `snapshot-contract` fixture command and does not come from MCP response data.

Before bytes are read, every physical ancestor is lstat-checked as a nonsymlink directory; leaf must be a nonempty regular nonsymlink file with linkcount1 and size≤1MiB. O_NOFOLLOW|O_NONBLOCK opens the leaf, and descriptor/named-file identities plus ancestor identities are checked before and after the read. The allocated/read bytes are bounded by the validated file size (maximum1MiB, no extra sentinel byte). Truncation/growth/identity changes refuse. UTF-8 is strict and NUL content refuses. Errors use fixed `SNAPSHOT_OBSERVATION_INVALID`, without path/error-value disclosure. This is a narrow local observation helper, not a general artifact resolver or a new OS isolation boundary. Metadata checks detect observed races; synthetic tests do not prove absence of all same-UID concurrent filesystem races.

## Meaningful offline verification

Copied fixtures in the test are the actual canary3 responseid3 and exact saved YAML; source-proof independently compares both to immutable evidence. YAML SHA256 `f04e9fd7f885796009058a2db52cc1bb1eda9a2b0952d1c779c7e14b96be91a5`. The expected RED executes the existing text-only projection and fails because the saved linked response contains no inline marker. It does not launch the browser branch or use missing-module failure.

Focused GREEN passes after helper integration. Cases cover existing inline, saved relative linked and canonical absolute paths; exact1MiB positive boundary; missing, escape, sibling-root, symlink, oversized, empty, FIFO, directory, invalid UTF-8, hardlink, URL, encoded path, multiple links and symlinked physical-root refusals. Positive observations preserve URL/title/marker/Continue ref. The source fix leaves actual CLI flags/security unchanged; it does not claim subsequent browser operations will pass.

Raw commands/results: `playwright-static/snapshot-fix/commands-and-results.json` records exact argv and exit1 expectedRED, exit0 focusedGREEN, exit0 covering. Raw outputs: `red.log`, `green.log`, `covering.log` in that same directory. Focused1/1 passes; final changed static area5/5 passes once. An offline self-review tightened the read allocation from size+1 to exactly size before final covering, with an exact1MiB case. No unexpected test failure occurred; no unchanged mapper/runtime or browser suite was rerun.

## Frozen review package

`playwright-static/snapshot-fix/snapshot-only.diff`: 15573 bytes, SHA256 `e5c80ef5cfa33a30838254f696375b0def933e1b969c10f18caf134e5919cb7a`. `source-proof.json` includes two before/after pins, all eight unchanged release-source pins, saved-fixture identity, actual call-site count and unchanged screenshot classifier. Two `.before` files preserve the starting checkpoint. No commit/hooks are authorized or claimed. Source writer is released for root's scoped review; any actual same-check browser recovery needs a new explicit cause-based release and must preserve count3 until a real pass.
