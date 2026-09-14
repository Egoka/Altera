# Task 5 strict Codex TOML mapper — independent review

**Spec compliance: NEEDS FIX. Code quality: NEEDS FIX.** Three Important findings remain in the exact three-file change. Keep the first actual mapping closed until they are fixed and independently re-reviewed. This verdict does not reopen runtime integration or static Playwright acceptance.

Reviewed base `86fec1eef63fd41d3864c22b44362c50a88617e7` → head `123d1e6f9c6c5199c8a4fe6bf16b451bfe11a084`. Immutable `task-5-codex-toml-mapping-review/scoped.diff`: 53,317 bytes, SHA-256 `15f2f200beadb77f1c45173362af6c0fedcf87aa206944091cfc57ff3efa150e`. The pre/postcommit artifacts agree on exactly the mapper, its test file and the added documentation section, with matching blob identities/modes and clean owned paths. Unrelated root evidence remains excluded.

## Findings

### R1 — Important: Reject semantically existing MCP tables in the base policy

Location: `scripts/agent-runtime/codex_toml_map.py:592` (`_read_base_policy`).

The exclusion tests only the byte substring `[mcp_servers`. A valid TOML table such as `[ "mcp_servers".unmanaged ]` passes even though it defines an MCP server. With an explicit-empty native managed block, `materialize` then publishes that base table and returns `managed_mapping_verified: true`, while the catalog says `explicit_empty` and all three rows are absent. The generated policy can therefore contain MCP authority absent from its supposedly complete managed catalog.

The named synthetic probe supplies exactly that secret-free base with its correct coordinator digest and observes all three conditions: verified mapping, explicit-empty catalog, and preserved unmanaged table. A digest proves the supplied base bytes match the caller's reference; it does not implement the brief's independent requirement to reject **any** existing MCP table/managed marker in the base.

Required fix: validate the base with a deliberately bounded schema/lexical subset that rejects all supported spellings of existing MCP authority, including whitespace/quoted/dotted table forms, or constrain accepted base syntax enough to exclude them. Preserve the reviewed base digest check. Add a focused regression asserting refusal and no publication for the demonstrated table spelling, plus the equivalent forms admitted by the selected base subset. No general TOML platform dependency is required.

### R2 — Important: Bind the published file to the validated temporary inode and directory

Location: `scripts/agent-runtime/codex_toml_map.py:641` and `:652` (`_write_atomic`).

The writer validates and closes the temporary fd, then links by pathname. Its final check compares only regular-file metadata, UID, mode, link count and length; it does not compare the final object to the validated temporary device/inode, content identity or ctime. A replacement temporary file with the same length/mode passes, and the returned policy digest is still calculated from the original in-memory policy.

The focused synthetic publication probe replaces only `codex-config.toml`'s temporary entry immediately before `os.link`, preserving size and private metadata. The call returns `managed_mapping_verified: true`, but the actual published bytes do **not** match its reported `policy_sha256`. This is a race before final validation, within the brief's requested descriptor/revalidation boundary; it is not the explicitly excluded case of a hostile same-UID change after the final check.

Required fix: retain and validate the output directory/temporary descriptors across publication, bind named/held final identity to the file whose bytes were written and synced, and reject replacement before returning verified output. Account for the legitimate link/unlink metadata transitions. Cleanup must remove only this attempt's proven entries and retain the existing no-overwrite behavior. Add the demonstrated same-size replacement regression; no live mapping is necessary.

### R3 — Important: Make public failures fixed and non-disclosing for malformed values and filesystem errors

Location: `scripts/agent-runtime/codex_toml_map.py:50`, `:394` and `:400`.

`_fail` raises a fixed `MappingError` without suppressing an active underlying exception. The descriptor walk catches an `OSError` and calls it, so a normal formatted traceback includes the original failing path component. The synthetic missing-task-directory probe reports outer `MappingError("descriptor_invalid")` but confirms the traceback also contains the task directory component. Checking only `str(error)` does not establish the required error non-disclosure.

Separately, the exact-field semantic checks perform set membership before validating types. Parsed `trace.command = ["..."]` and nested `playwright.args = [["..."]]` both raise unhandled `TypeError` rather than the fixed failure/result enum. Both forms are legal values in the mapper's parser subset and must be rejected by the semantic mapper without an uncontrolled exception surface.

Required fix: suppress raw exception chaining at fixed-error conversion boundaries and ensure public mapper operations normalize expected input/filesystem failures without offending names or values. Validate command and argv element types before hash/set membership. Add focused assertions for the complete rendered exception output and the two malformed semantic shapes, not only the outer exception string. Retain strict refusal; do not coerce these values into accepted commands.

## What the change correctly establishes

- The materializer validates pinned D2 identities/status and expected cwd, then walks the candidate from `/` through retained no-follow descriptors. UID/no-group-world-write checks start at the workspace boundary, accepting the approved directory mode0755. The final config is opened nonblocking before regular0600/owner/link/size checks, and input identity checks/reopen logic include ctime.
- Marker authority is distinct from inherited content: absent markers refuse, explicit-empty is represented separately, and a bounded lexical guard refuses multiline ambiguity before the strict managed subset is parsed.
- The catalog has fixed rows and bounded canonical serialization. Exact Context7 and the two native trace identities map deterministically; dynamic Playwright forms remain unready, with no executable/network/install operation in this module.
- The intended-roster check can reject a structurally valid empty/incomplete set. Source/AGENTS/native run bindings remain the trusted coordinator's separate responsibility. The mapper does not open `auth.json` or `AGENTS.md` and does not modify the runtime/proxy/refresh/guard/image or scheduler.

These strengths do not eliminate the publication and semantic-base discrepancies above.

## Verification and retained evidence

Read both briefs and the implementation report, treating the latter as claims. Read the immutable diff once in chunks. Trace outline for the execution path returned `SECURITY_VIOLATION`; immutable exact-revision source was used only for the named-risk probe and precise finding locations. No mutable source crawl or implementation changes occurred.

Read raw `task-5-codex-toml-mapping-final.log` and `task-5-codex-toml-mapping-postcommit.log`: both report **13/13 passed**, matching the supplied test code. Read `task-5-codex-toml-mapping-format.log`: Prettier check passed. Those tests cover useful nominal, marker, parser-bound, descriptor-file-race, redaction and partial-publication cases, but do not exercise the demonstrated base spelling, temporary replacement or complete traceback failure surface.

The report and root retain a commit-hook warning: host Node **24.3.0** differs from pinned **24.12.0**; the hook otherwise reportedly passed server 19 plus one todo and web 5 tests. The supplied report does not identify a separate retained raw hook-output file, and the named mapper logs inspected here do not contain it. This review therefore does not independently attest that hook transcript or claim verification under pinned Node. The warning does not by itself block this Python 3.9 standard-library mapper and does not justify rerunning unrelated workspace suites. Preserve it as an environment limitation.

One new focused synthetic probe was run, because the four named risks were unanswered by the existing evidence. `task-5-codex-toml-mapping-review/named-risk-probe.py` loads only the exact committed mapper, verifying source SHA `e26bb20479efd6c8e6033fa6832716c5530a673e753a87deb9d78304c2c93391`, and uses private synthetic files/values. Its retained `named-risk-proof.json` records:

| Probe | Actual result |
| --- | --- |
| Quoted/whitespace base MCP table + managed-empty config | Verified mapping, explicit-empty catalog, unmanaged table preserved |
| Same-size temporary policy replacement before hard-link | Verified mapping, published digest differs from returned digest |
| Missing synthetic task directory | Fixed outer code, raw task component present in full traceback |
| Array-valued trace command | Unhandled `TypeError` |
| Nested Playwright argv | Unhandled `TypeError` |

The probe exited0 because it records observations; that exit is not a passing mapper-acceptance result. No existing suite was rerun by this reviewer. No real D2 path/config, auth/store, native API, MCP/model, container or provider operation was performed. Probe fixture directories were removed after the observations; the script and sanitized proof remain.

## Acceptance boundary and disposition

**First independent task review: negative.** Return R1–R3 as Important fixes and preserve all existing failure history. Do not convert the focused probe's successful execution or the retained 13-test runs into independent acceptance. A subsequent scoped re-review should verify the original findings and fix-introduced breakage; it should not restart a broad mapper/runtime audit.

No historical first map or future Codex native launch is accepted here. Actual authoritative roster, static Playwright artifact, generated policy review, preserved source/context, and later native tools/model acceptance remain the previously declared separate gates.
