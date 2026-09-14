# Task 5 Codex managed-TOML mapper implementation report

Date: 2026-09-14  
Base: `86fec1eef63fd41d3864c22b44362c50a88617e7`  
Head: `123d1e6f9c6c5199c8a4fe6bf16b451bfe11a084`  
Commit: `feat(runtime): map Codex managed MCP config`

## Result and exact scope

The commit contains exactly:

- `scripts/agent-runtime/codex_toml_map.py` — Python 3.9 standard-library
  library API with pure `build_mapping(...)` and descriptor-backed
  `materialize(...)`; no CLI/scheduler integration was added.
- `scripts/agent-runtime/test_codex_toml_map.py` — synthetic filesystem and
  parser tests only.
- the new `Codex managed-TOML mapping` section in
  `docs/development/runtime-isolation.md`.

No runtime launcher/builder, Dockerfile, protocol/proxy, refresh, auth, product,
native profile, API, or gate source changed. Root-owned execution report,
refresh-live evidence, and committed-integrity `final-audit.json` remained
outside the index.

## Implemented contract

- Pins the accepted D2 source/build/binary identities and requires
  `lexical_candidate`, `cwd_matches_expected: true`, and both acceptance fields
  `not_checked`; candidate grammar remains the exact pinned workspace
  `alte-N-12hex/codex-home` form.
- Opens `/` and every absolute path component through held directory FDs with
  `O_NOFOLLOW`. UID and no-group/world-write rules start at the private
  workspace boundary, so mode0755 is valid. It opens only `config.toml` with
  `O_NONBLOCK` before `fstat`, requires regular0600/expected UID/nlink1/≤64 KiB,
  and performs full pre/post and held-parent reopen checks including ctime_ns.
- Uses a bounded lexical guard and renderer-subset value parser rather than a
  general TOML dependency: strict UTF-8/LF, exact final marker suffix, depth16,
  decoded strings16 KiB, single-line basic strings/booleans/finite JSON decimal
  numbers/arrays/inline tables, and fixed non-disclosing error enums.
- Produces a fixed three-row canonical redacted catalog. Unknown server/field
  names, secret-bearing names/values, native paths, raw TOML, and their hashes
  cannot enter the catalog. The mapping digest binds only canonical catalog
  bytes plus the reviewed mapping-policy version.
- Maps only exact public Context7 and either accepted native trace identity with
  `args=["serve"]`. It recognizes the four approved dynamic Playwright `npx`
  forms but returns `playwright_dynamic_npx`, `mapping_ready:false`, no path map,
  and no policy block.
- Keeps missing managed markers distinct from explicit managed-empty. Required
  roster absence stops publication. Inherited MCP tables outside the exact
  marker block are never copied.
- Verifies the secret-free base-policy digest and absence of existing MCP
  tables/markers, then publishes catalog and policy as mode0600 through
  exclusive temporary creation, file/directory fsync, atomic hard-link, and
  cleanup of partial publication. Existing destinations are never overwritten.
- Never enumerates the task home or opens `auth.json`/`AGENTS.md`; no executable,
  package, MCP, model, native CLI, network, profile, or credential operation is
  available in the module.

## TDD and failure history

The initial RED, saved as `task-5-codex-toml-mapping-red.log`, exited1 because
the production module did not exist. The first GREEN attempt exited1 before
test discovery: `/usr/bin/python3 -I` intentionally omitted the script
directory from `sys.path`, so the ordinary import repeated the missing-module
signature. This is harness failure1 for the new mapper check, saved in
`task-5-codex-toml-mapping-green.log`. The cause was corrected once by using the
same explicit `importlib.util.spec_from_file_location` pattern as accepted D2;
`task-5-codex-toml-mapping-green-2.log` then passed 12/12 and reset that check.

Mutation review added two expected focused REDs:

- `task-5-codex-toml-mapping-atomic-red.log` proved that a directory-fsync
  failure after hard-link publication left one partial catalog; source cleanup
  now removes a linked-but-incomplete destination.
- `task-5-codex-toml-mapping-line-ending-red.log` proved U+2028 reached marker
  classification instead of the canonical-line-ending rejection; U+0085,
  U+2028 and U+2029 now fail as `config_encoding_invalid`.

These were intentional REDs for new regression cases, not failed production
verification attempts. `task-5-codex-toml-mapping-green-3.log` then passed
13/13. No check reached two consecutive unexpected failures, and no historical
Task 3/D1/D2/refresh count was changed.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `/usr/bin/python3 -I scripts/agent-runtime/test_codex_toml_map.py` before commit | exit0, 13/13 | `task-5-codex-toml-mapping-final.log` |
| `pnpm exec prettier --check docs/development/runtime-isolation.md` | exit0 | `task-5-codex-toml-mapping-format.log` |
| staged `git diff --check` | exit0 | no output |
| normal commit hook: root Prettier, ESLint, workspace tests | exit0 | server 19 passed/1 todo; web 5 passed; hook warned host Node24.3.0 differs from pinned24.12.0 |
| same focused mapper suite after commit | exit0, 13/13 | `task-5-codex-toml-mapping-postcommit.log` |

The hook's workspace suite ran once because the requested normal-hook commit
invoked it; it was not repeated manually. No Docker/build/native/model/config or
auth check ran.

## Frozen review package

`task-5-codex-toml-mapping-review/precommit.json`, `scoped.diff`, and
`postcommit.json` record:

- exact three-path staged and committed scope;
- scoped diff SHA-256
  `15f2f200beadb77f1c45173362af6c0fedcf87aa206944091cfc57ff3efa150e`;
- committed source hashes:
  - runtime documentation:
    `89d22c1c3fef3da99788c4ef287e2dc7954ca5a1dca48e3a781e7eabdfd12c16`;
  - mapper:
    `e26bb20479efd6c8e6033fa6832716c5530a673e753a87deb9d78304c2c93391`;
  - tests:
    `80d9b5f34c6c2d4dba13e9e87823c7a07fdc7c450b38ceb89ca9591c618d2e6e`.

The committed diff equals the precommit frozen diff, all blob hashes/modes
match, and all three owned paths are clean. Trace-first project map succeeded
(290 files, 3,430 symbols). The execution-worktree runtime paths were absent
from the original index; exact base Git source was used after the required
outline attempts returned `NOT_FOUND`. Post-edit `register_edit` likewise
reported indexed0/errors1 for these worktree paths; it did not identify a
duplicate.

## Remaining boundary

This commit proves synthetic mapper behavior only. The same-UID producer trust
limit remains after final descriptor revalidation. Source/AGENTS snapshot and
run identity are coordinator-owned run-record inputs and are not rewritten by
this library. The historical D2 first map, real `config.toml` read, generated
policy review, actual roster, static Playwright closure, MCP tools, and Codex
model/native acceptance remain separate. No real path/config/auth bytes were
read during implementation.

## Fix round 1 — independent review R1–R3

Fix base: `123d1e6f9c6c5199c8a4fe6bf16b451bfe11a084`. Independent mapper review
count before this fix: **1**, with three Important findings. This round changes
only the same owned mapper, mapper test, and narrow runtime-isolation section.

- **R1:** the reviewed base digest remains mandatory, and a bounded key-path
  scanner now rejects semantic top-level MCP authority expressed as bare,
  quoted, whitespace-separated or dotted table, array-table, and assignment
  forms. Multiline or unparseable base-key syntax fails closed.
- **R2:** the private output generation stays open as a held directory FD.
  Temporary and final names are accessed relative to it; the writer retains the
  temporary FD across the exclusive hard-link, binds held temporary and named
  final device/inode metadata through the legitimate link-count/ctime changes,
  reopens and rereads the final bytes, and revalidates the named directory
  against the held directory before success. Cleanup unlinks only a name whose
  current inode still matches the entry proven for this attempt.
- **R3:** fixed `MappingError` conversion uses suppressed exception chaining,
  and trace/Playwright command and argv element types are validated before set
  or tuple membership. The demonstrated legal parser-subset arrays now return
  the fixed `unverified_managed_config` result instead of `TypeError`.

### Focused TDD and retained raw output

The exact RED command was:

```text
/usr/bin/python3 -I scripts/agent-runtime/test_codex_toml_map.py CodexTomlMappingTests.test_base_policy_semantic_mcp_forms_refuse_without_publication CodexTomlMappingTests.test_publication_rejects_replaced_temp_inode_and_preserves_foreign_entry CodexTomlMappingTests.test_public_errors_suppress_causes_and_validate_semantic_types
```

It exited 1 against `123d1e6`: the quoted base table published, the same-size
temporary replacement returned verified, the complete traceback disclosed the
synthetic task component, and malformed semantic values had not yet reached
their assertions. The first successful base subtest left outputs that caused
the remaining base variants to cascade as `output_exists`; before production
changes, the test fixture was corrected so each variant uses its own synthetic
generation. The original raw RED is preserved at
`task-5-codex-toml-mapping-fix1-red.log`; it was not rewritten.

The cause-corrected GREEN used the same three named tests and exited 0, 3/3, at
`task-5-codex-toml-mapping-fix1-green.log`. After the final cleanup-lifecycle
hardening, the exact whole-file command
`/usr/bin/python3 -I scripts/agent-runtime/test_codex_toml_map.py` ran once and
exited 0, 16/16, at `task-5-codex-toml-mapping-fix1-final.log`. No actual D2
path/config, auth, model, native API, Docker, MCP, or provider operation ran.

The focused Prettier check for `docs/development/runtime-isolation.md` exited 0
but was not separately archived; its direct tool transcript is the only raw
record. The original `123d1e6` normal hook likewise has no filesystem raw log:
its Node24.3 warning and reported pass remain secondary evidence and are not
reconstructed. This fix's required normal commit uses the explicit pinned
Node24.12 PATH and retains its raw hook output separately.

### Fix-round commit and frozen package

Fix-round commit: `ccadb408e22936ad00779778a7bbc5799cb87afa`
(`fix(runtime): harden Codex TOML mapping`), with parent/base `123d1e6`. The
normal commit was invoked with `login:false` and
`PATH=/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin:$PATH`; it exited 0.
Its raw `task-5-codex-toml-mapping-fix1-hook.log` has SHA-256
`cdd58007deb8554f9154c02780a04b4f9830d7a77dbcfb24021741da287068c7` and records
Prettier and ESLint passing, server 19 passed/1 todo, and web 5 passed. The old
Node24.3 warning is retained only in the original history; the fix hook emitted
no version warning.

Frozen files under `task-5-codex-toml-mapping-review/` are:

- `fix1-scoped.diff`, SHA-256
  `2fd5ef665405080f9cbdedca6dcd1364dbe4c558f5fa07e7bd219fb33a9110e6`;
- `fix1-precommit.json` with the staged base/scope/blob/source/test identities;
- `fix1-postcommit.json` with the committed head, exact hook log, and clean
  owned-path result.

The committed diff exactly equals the frozen precommit diff and contains only
the three owned files. Final committed SHA-256 values are:

- `docs/development/runtime-isolation.md`:
  `fce1aa71dea724b0f5359a54f071ceec754b11af38260b5ce6ea4b49b73f8fd2`;
- `scripts/agent-runtime/codex_toml_map.py`:
  `60b9c909076efcad8223a5584442ab357f5a255b4a07df9fc89bd4e4a1ba0ae1`;
- `scripts/agent-runtime/test_codex_toml_map.py`:
  `350d65bacc0eb6da3f7900edc6c42cd3bc3874b3a58dfab9086db3eef8896813`.

All owned paths are clean. Root-owned execution-report, refresh-live,
committed-integrity, Playwright-default, and post-refresh Multica evidence
remain unstaged and untouched by this fix. Historical first mapping and every
actual runtime acceptance gate remain outside this synthetic fix round.

## Fix round 2 — N1 cause correction only

Fix base: `ccadb408e22936ad00779778a7bbc5799cb87afa`. The second consecutive
independent review remains stopped at count **2**; this source correction and
its tests do not reset or rename that check and do not constitute recovery
review. Original R1–R3 remain addressed.

N1's cause was the ordering of the final publication reopen: fix1 opened the
name without `O_NONBLOCK` and called `_read_published` before comparing the
opened object with the still-held validated temporary inode. The frozen review
probe therefore observed 29 synthetic foreign bytes before `output_invalid`.

The final reopen now uses `O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK`.
Immediately after open, and before any read, it requires a regular mode0600,
expected-owner, link-count-one, exact-size object; compares its stable inode
identity with the link-proven identity; and compares its full metadata,
including ctime, with the still-held temporary descriptor. Existing post-read
opened/held/named identity, byte equality, directory binding, and
identity-checked foreign-entry cleanup remain in place. No documentation
change was required.

### Fix2 focused evidence

The exact focused command was:

```text
/usr/bin/python3 -I scripts/agent-runtime/test_codex_toml_map.py CodexTomlMappingTests.test_final_reopen_rejects_foreign_regular_file_before_any_read CodexTomlMappingTests.test_final_reopen_refuses_fifo_nonblocking_before_any_read
```

Against `ccadb40`, the RED exited 1 with two expected failures: the substituted
regular file recorded 29 bytes read, and the final-open flags lacked
`O_NONBLOCK`. Raw output is
`task-5-codex-toml-mapping-fix2-red.log`, SHA-256
`b3d33f94d4cd9dfc42dad8248eec1ac5705ffd2052cc57737599758d3109614e`.

After the cause correction, the same command exited 0, 2/2. It proves the
foreign regular file is refused with zero reads and preserved by cleanup, and
the FIFO substitution is opened nonblocking, rejected before a read, and also
preserved. Raw output is `task-5-codex-toml-mapping-fix2-green.log`, SHA-256
`3ae4c428ef2a36262c7985594ad4e0ce0a7102e95909c3f0300b23fe1301f426`.

The one permitted final covering command
`/usr/bin/python3 -I scripts/agent-runtime/test_codex_toml_map.py` exited 0,
18/18. Raw output is `task-5-codex-toml-mapping-fix2-final.log`, SHA-256
`82c5dca45730adf588861f4b5588f590efe177c7db0c32ac8779395a6c1aeb69`.
Precommit source SHA-256 values are
`a2da623a4a2ec46617dc2f8c697281bc042f0aaeb29798aaa7c4bcfd59afad09`
for `codex_toml_map.py` and
`f4638922fd8cdd8851dbb1a30b6ffcc0e19f315d26af460ee21e7ade7d2377b1`
for its test.

No stopped independent review, historical mapping, real config/auth read,
model, API, Docker, MCP, native operation, or unrelated suite ran. The required
owned-only normal commit will use `login:false` and the explicit pinned
Node24.12 PATH, with a new raw hook transcript.

### Fix2 commit and frozen result

Commit `9ed8b88c11d802c6f9b5d89b89eeccff2e1bda1b`
(`fix(runtime): validate Codex final file before read`) has parent `ccadb40` and
contains exactly the mapper and its focused test. The committed source hashes
equal the precommit hashes above. The committed binary diff equals
`task-5-codex-toml-mapping-review/fix2-scoped.diff`, SHA-256
`c58be0b4e1a28656562b7f983946c1a551a86073d417fca4774c39f9e6746b11`.

The pinned Node24.12 normal hook exited 0: Prettier and ESLint passed, server
reported 19 passed/1 todo, and web reported 5 passed. Raw output is
`task-5-codex-toml-mapping-fix2-hook.log`, SHA-256
`7c8d7b555d6e409a183a06cb3e8c0163c8fae86e1d8d5c943194f1fcddba4436`.
`fix2-precommit.json` and `fix2-postcommit.json` bind the stopped count2, exact
two-file scope, source blobs/hashes, test logs, and the corrected-source proof:
foreign regular read bytes 0; FIFO `O_NONBLOCK` true; FIFO read bytes 0; both
foreign entries preserved by identity-safe cleanup. All owned paths are clean.
