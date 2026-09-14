### Spec Compliance

- ✅ Spec compliant for this bounded reviewer MCP policy milestone. `scripts/agent-runtime/runtime.py:216` accepts only the two known server names. Trace preserves exact Linux executable plus `["serve"]` or the previously supported `["serve","--preset","review"]`; Context7 requires exactly HTTP `https://mcp.context7.com/mcp` with no extra fields. The policy path is forwarded without rewriting its bytes. Unknown names/types/fields, headers/env including empty objects, malformed/duplicate-key JSON and non-JSON constants fail before execution (`scripts/agent-runtime/runtime.py:197`, `scripts/agent-runtime/test_runtime.py:167`).
- ✅ The proxy whitelist expands by exactly `mcp.context7.com`; port, authority, public IPv4 and isolated-network behavior are otherwise unchanged in the diff (`scripts/agent-runtime/provider-proxy.mjs:16`). New tests cover exact-host acceptance and deceptive/case/port/path/IPv6 forms (`scripts/agent-runtime/test_proxy.mjs:37`).
- ✅ The no-model canary uses the existing pinned image and launcher boundary with synthetic source/snapshot/RO policy, no auth mount and no model CLI. It performs actual Context7 initialize/list/read-only resolve plus trace index/list/map/outline with the observed `["serve"]` arguments, verifies content and records six forbidden CONNECT responses (`scripts/agent-runtime/test_mcp_canary.py:62`, `scripts/agent-runtime/reviewer-mcp-canary.mjs:125`, `:167`, `:281`).
- ✅ Exact native descriptor evidence is preserved: `docs/reports/evidence/2026-09-13-autonomy/d1-native/native-descriptor-proof.json:24` identifies Context7 public `/mcp` without headers/env and trace host-name with `trace_serve`, without model acceptance. The implementer follows the root’s observed-argv ruling; the earlier standalone review preset remains a separate accepted option.
- ✅ Only the approved seven files appear in the immutable diff: runtime, proxy, their tests, canary/client tests and runtime documentation. No D1, guard, Dockerfile/package/image, product/gate/auth/native-profile mutation is present.
- ⚠️ This proves local reviewer policy and actual container MCP tools, not full native preservation. Live adapter argv/stdin/context materialization, Codex per-task config, tester Playwright, model hook/context behavior, credential refresh and trusted collector remain explicitly unaccepted (`docs/development/runtime-isolation.md:24`, `:81`, `:127`; `task-5-mcp-policy-report.md`, Remaining scope). No native binding or autopilot activation follows from this review.

### Strengths

- Validation is conservative without silently replacing the observed trace argument vector; parsing rejects duplicate JSON keys before a later value can conceal an unsupported input (`scripts/agent-runtime/runtime.py:197`, `:217`).
- Canary success depends on matching successful MCP responses and real tool payloads, not HTTP connectivity or marker-only text. Trace requires exact synthetic source counts and fresh outline identity; Context7 must yield an actual public library ID (`scripts/agent-runtime/reviewer-mcp-canary.mjs:13`, `:81`, `:100`).
- Context7 requests use a fixed public query, reject redirects, bound streamed bodies and stored protocol, and retain session headers only in memory (`scripts/agent-runtime/reviewer-mcp-canary.mjs:52`, `:94`, `:130`).
- Failure evidence remains visible: the first real canary failed the trace-content assertion; the subsequent regression fix checks the actual structured summary instead of weakening it to a connectivity check (`scripts/agent-runtime/test_mcp_canary.py:50`). The second run is independently bound to source/snapshot/policy/runtime/image evidence (`scripts/agent-runtime/test_mcp_canary.py:100`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- None.

#### Minor (Nice to Have)

- None found in the scoped implementation. The disclosed first canary assertion failure remains failed evidence; successful later evidence does not erase it. Normal-hook todo/skipped product cases remain outside this milestone’s acceptance.

### Checks and Evidence

- Read the exact brief/report and all seven-file immutable diff sections once, without changed-source rereads or a broader crawl. Base d4bf8b898217196b0450d174d0a2a90550a4e66c → head 563844e6461b76c97065842efb1cb0f5b9b5099f. Independently computed scoped diff SHA256 `09269fc9c171c7b68c60b09fdf3707240fb1282f144e8156f2371d472c306090`, matching the dispatched package and source-proof record.
- Read raw final logs directly: Python runtime 19/19 (`task-5-mcp-policy-python-green.log`), proxy 2/2 (`task-5-mcp-policy-proxy-final.log`), canary contracts 4/4 (`task-5-mcp-policy-canary-final.log`). No failures/skips/todos/warnings in those covering logs. Tests assert actual rejection, exact preserved argv/policy bytes, JSON/SSE validation and bounded stream cancellation.
- Read the second canary’s stored request/response exchanges. Trace initialize identifies version3.25.0, tools/list exposes get_project_map/get_outline, map reports fileCount1/symbolCount1/javascript, and outline reports fresh `sample.js::answer#function`. Context7 initialize is HTTP200/protocol2025-03-26, initialized notification202, tools/list exposes resolve-library-id, and the real call returns five public React library IDs. These were inspected as untrusted recorded protocol data, not fresh tool invocations or instructions.
- Read `mcp-policy-canary-2/run/evidence/reviewer-mcp-result.json` and `exit.json`: all three phases succeed, six negatives are403, actual exit0, before/after identities unchanged. Exact synthetic source SHA `ff5b402f15c0ccacb5ee990f27401867e5c8e387`; policy hash `13a509487439f67a6e15f0c55c5ce107ed663291fc11e0df374790c3e5f2b38f`; runtime hash `435abda70f7ca56dce248ee5087f1a5dfea6bdb492bb53d6c7fa423a21ae3f99`. Independently hashed the second RO fixture copy: `3a472fd7ed360d2802c0acfc64c9d416713e24113be40d0f78a2d38b06e00c80`, matching the frozen canary source identity.
- Read the stored cleanup/image proof: the exact network/container are absent afterward, and image readback matches `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a`. The expected inspect-not-found exit1 values are cleanup evidence, not failed runtime checks.
- Read the first canary’s exit1/result: Context7 and all six CONNECT denials already succeeded; trace-content validation failed. The first failure remains recorded, and only actual subsequent success resets that check’s consecutive-failure count. No stopped Task3 or historical D1 check was rerun by this review.
- No new tests, native/Docker/model/MCP/auth/profile actions, live config/home reads, source/index/HEAD changes or subagents. The separately requested Claude environment memo was completed before this review from historical D0 metadata only; it states the observed variables were absent and no lexical managed-home paths were established. The only review output here is this requested report.

### Assessment

**Task quality: Approved.**

**Reasoning:** The change faithfully validates the observed reviewer roster, adds one exact proxy destination, and proves real no-model MCP operation with bounded evidence while preserving the existing OS boundary. The remaining native/model/context/refresh/collector acceptance is correctly kept separate.
