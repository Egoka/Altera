### Finding Verdicts

- **[P2] Do not interpret option values as MCP flags — ADDRESSED.** The finite option catalog and `read_arguments` consume each known scalar option’s value once and never rescan it (`scripts/agent-runtime/metadata-config-probe.c:338`, `scripts/agent-runtime/metadata-config-probe.c:347`). Only the parsed genuine MCP option sets the read path; duplicates, unknown options, extra positional values and boolean equals forms fail before `read_config` (`scripts/agent-runtime/metadata-config-probe.c:383`). Regression coverage includes both separate/equals MCP-looking prompt and other values, genuine MCP options after them, unsupported/ambiguous argv, real duplicates, and the observed native argument shape (`scripts/agent-runtime/test_metadata_config_probe.py:137`).

  Original finding, verbatim:

> **[P2] Do not interpret option values as MCP flags.** `scripts/agent-runtime/metadata-config-probe.c:335` scans every argv token for `--mcp-config` or its equals form, without consuming the opaque values of known flags such as `--append-system-prompt`, `--system-prompt` or `--model`. A focused test against the exact frozen binary passed only two arguments: `--append-system-prompt` and the literal prompt value `--mcp-config=NEW_SYNTHETIC_PRIVATE_PATH`. There was no actual MCP option, but D1 opened that file and reported `read_status: ok`, `path_class: daemon_private_temp`, and `known_flags: ["--mcp-config"]`. This promotes ignored prompt text into authority to read a private daemon-shaped path and produces a false invocation descriptor. Parse the known native option arities so their values remain opaque; refuse ambiguous/unsupported argv shapes rather than searching their values. Preserve exactly-one MCP option handling for both supported forms and add negative tests for MCP-looking prompt/other values plus genuine duplicate options. This issue does not demonstrate arbitrary-path access, secret output or execution; those boundaries remained intact.

- **[P3] Emit the required unreviewed-fields summary, including top-level unknown fields — ADDRESSED.** The root now counts keys outside `mcpServers`; output includes root/server `unreviewed_fields`, retained server/header unknown counts, header review state, and env count/type/review metadata (`scripts/agent-runtime/metadata-config-probe.c:258`, `scripts/agent-runtime/metadata-config-probe.c:385`). Opaque env objects stay unreviewed, including empty env; invalid structures and unknown values remain unresolved. New tests assert root/server/header/env counts and booleans, both valid and mismatched types, reviewed-header exactness, and secret-canary non-disclosure (`scripts/agent-runtime/test_metadata_config_probe.py:168`).

  Original finding, verbatim:

> **[P3] Emit the required unreviewed-fields summary, including top-level unknown fields.** `scripts/agent-runtime/metadata-config-probe.c:250` makes a top-level extra field unresolved but never counts it, and the output at lines 343–348 has no `unreviewed_fields` boolean at any level. The same focused fixture included one extra top-level synthetic field: the descriptor correctly stayed unresolved but reported `unknown_servers: 0` and its recognized server’s `unknown_fields: 0`, leaving the reason unrepresented. Add a bounded count and the specified `unreviewed_fields: true` flag for unreviewed top-level/server/header/env structures, without exposing keys or values. This is a descriptor-contract/completeness defect, not unsafe mapping acceptance: the current implementation still refuses exact mapping for the unknown field.

### New Breakage in the Fix Diff

- None found. The two-file fix changes argument parsing and descriptor metadata without expanding filesystem, process, network, model or credential capability. Unconditional descriptor enumeration after JSON parsing remains bounded: decoded duplicate server keys are rejected by the existing strict parser, only three known catalog names create descriptor entries, and exceeding eight servers keeps mapping unresolved (`scripts/agent-runtime/metadata-config-probe.c:260`).

### Out-of-Scope Observations

- No new out-of-scope code findings. Full native/bridge/MCP/context/hook/auth-refresh acceptance remains pending; local D1 diagnostic acceptance is not execution authorization. Existing wrong-file-owner/device-fixture and same-UID producer/loader-trust limits remain explicit in the report. This verdict does not register, bind or run any native profile.

### Checks

- Read the complete immutable fix diff once: `task-5-d1-fix1-review.diff`, base bbe668c59b3f3dbfe3c2a8bb0157f9e4e6e0fcff, head 89290c074b895edbe163ebbb626e80d9db4cbcff. Compared only the original P2/P3 findings and new fix breakage against the unchanged Milestone A contract; no source crawl, code-file reread or Git inspection.
- Read the appended D1 fix1 report and its named focused GREEN/full logs directly. `task-5-d1-fix1-green.log`: 3/3 passing. `task-5-d1-fix1-full.log`: 21/21 passing, including argv-value regression, unknown-field descriptors, strict parser/path checks, deterministic race fixtures and sandbox controls; no warnings, failures or omitted cases in this covering log. No suites or new probes were run by this re-review.
- Independently SHA-256 verified all nine named regular artifacts in `d1-fix1-review/manifest.json`; all matched, including the reviewed diff, source, test, unchanged builder, binary, imports and pinned proof. Source SHA256 fc08cd669760e584511e9bf44629d6eee082ffb6128f7a1aeeb59e1b3cb5e0c7; binary SHA256 d0aa8b38065d2dfa0ed0fd6953be4554b2ceb8c884f416ddd60c17d0d5fe9464.
- Read the exact-binary canonical/approved-alias proof: both synthetic-only runs report diagnostic exit78, empty stdout and read_status ok; production daemon config was not read. Import list remains unchanged and contains no process/network/environment/Keychain additions (`d1-fix1-review/task-5-d1-fix1-pinned-proof.json:4`, `d1-fix1-review/task-5-d1-fix1-imports.txt:1`).
- Historical review failure1 and three compiler failures/remedies remain in prior artifacts; this is a successful scoped review after the fix, not a label/counter reset to bypass a failure limit. No native/model/config/auth actions, source/index/HEAD writes, external operations or subagents. Wrote only this requested review report.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** P2 and P3 are closed for 89290c074b895edbe163ebbb626e80d9db4cbcff. Milestone A’s scoped local D1 implementation is accepted; full native runtime acceptance remains separate and pending.
