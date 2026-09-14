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
