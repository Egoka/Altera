### Spec Compliance

- ✅ Spec compliant for this bounded protocol milestone. `scripts/agent-runtime/runtime.py:148` accepts only one exact `--listen stdio://` pair, forwards it at its incoming position, and retains the pinned model/medium configuration checks. Duplicate, missing, equals-form, non-stdio and unknown arguments remain rejected; `scripts/agent-runtime/test_runtime.py:197` verifies the exact constructed argv and targeted invalid variants.
- ✅ The service-tier exception is restricted to the direct object `params` of a root Codex `thread/start`, `thread/resume` or `turn/start` request (`scripts/agent-runtime/protocol-guard.mjs:15`). Object identity at line35 permits only the exact value `default`; no tier is rewritten. Root/params arrays, nested requests/config/objects, other methods and Claude-family messages receive no exception. Existing model/provider/effort/cwd/config-write/import guards and `serviceTierForTurn` behavior remain intact in the diff context.
- ✅ Tests cover upstream-shaped start/resume/turn requests, unchanged input buffers, null/omitted tiers, rejected alternative tiers, forbidden nesting/families/methods and model/provider/effort/cwd/config drift (`scripts/agent-runtime/test_protocol_guard.mjs:90`, `scripts/agent-runtime/test_protocol_guard.mjs:109`). Documentation accurately states both compatibility additions and remaining managed-home/TOML/AGENTS/native blockers, including fresh RO policy capture without an unnecessary image rebuild (`docs/development/runtime-isolation.md:71`, `docs/development/runtime-isolation.md:87`, `docs/development/runtime-isolation.md:99`).
- ✅ Exactly five owned files appear in the immutable diff; no D1, Docker image/package, auth, gate, product or Multica change is present. The later D1 diagnostic is a separate root operation and was not inspected or operated on by this review.
- ⚠️ Cannot verify full native/runtime acceptance from this diff, and it is not claimed. Managed CODEX_HOME discovery, authoritative TOML materialization, actual AGENTS context, live model/medium/default-tier readback and native canary remain separate prerequisites (`task-5-codex-bridge-preflight.md:1`, `docs/development/runtime-isolation.md:99`). Pure argv/JSON compatibility tests do not close those gates.

### Strengths

- Minimal implementation changes target the demonstrated incompatibilities: a single bounded listener branch and an identity-based exception for exactly three root RPC methods (`scripts/agent-runtime/runtime.py:150`, `scripts/agent-runtime/protocol-guard.mjs:15`).
- Positive tests verify forwarding and unchanged bytes; negative tests retain restrictions around transport, configuration and request shape instead of only asserting that the newly accepted values pass (`scripts/agent-runtime/test_runtime.py:197`, `scripts/agent-runtime/test_runtime.py:207`, `scripts/agent-runtime/test_protocol_guard.mjs:109`).
- The code never coerces fast/priority/unknown tiers to default, and the new guard cannot grant nested values the top-level exception (`scripts/agent-runtime/protocol-guard.mjs:35`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- None.

#### Minor (Nice to Have)

- None found in this scoped diff. Existing normal-hook todo/skipped tests are disclosed in the implementer report and are not represented as covered by this milestone.

### Checks

- Read the exact `task-5-codex-protocol-brief.md`, its parent-scratch `task-5-codex-bridge-preflight.md`, implementer report, and immutable `task-5-codex-protocol-review.diff` once. Reviewed base c11f9da82bb0aa0a05350dfc47c219913ba7bc2d → head d4bf8b898217196b0450d174d0a2a90550a4e66c. Independently computed diff SHA256 b274096ebecf4a9203f9e170f36213c8fe4a03f995bf6fbd81c8c2f9759d696a, matching the report.
- Read raw expected RED evidence: Python positive native-listener cases raised the prior unsupported_codex_argument, while its rejection test passed; JS positive native-tier acceptance raised the prior preserved_model_settings_changed, while its negative-scope test passed. These demonstrate the missing compatibility and are not unexplained harness failures.
- Read raw GREEN logs directly: `task-5-codex-protocol-python-green.log` reports 16/16 passing; `task-5-codex-protocol-js-green.log` reports 7/7 passing with zero failures/skips/todos. No warning noise in either covering log. `task-5-codex-protocol-result.json` binds the reported final commit/tree and five owned paths and records hooks exit0/verified-scope match.
- No suite rerun or additional test was needed: the immutable code and existing behavioral evidence answered the bounded risks. No broader source crawl, Git inspection, source/index/HEAD mutation, native/Docker/model/MCP/auth/config action or subagent. Only this requested review report was written. Historical check/review counters and unrelated root evidence were left intact.

### Assessment

**Task quality: Approved.**

**Reasoning:** The implementation accepts precisely the two demonstrated native protocol shapes, preserves exact model/effort/default-tier policy and byte forwarding, and retains the surrounding rejection behavior. The focused covering evidence is sufficient for this local compatibility milestone; full native/config/context acceptance remains pending.
