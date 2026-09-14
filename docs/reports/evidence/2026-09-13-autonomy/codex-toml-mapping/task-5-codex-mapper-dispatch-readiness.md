# Task 5 Codex mapper dispatch readiness

Date: 2026-09-14  
Verdict: **READY for the bounded synthetic mapper implementation once the sole
runtime-writer slot is released.** No unresolved product, security, parser, path,
roster, or MCP choice requires another preflight. Refresh review disposition is
a sequencing gate, not a mapper-interface question.

## Immutable implementation inputs

The writer should bind these read-only contracts before the first edit:

| Input | SHA-256 / immutable identity | Use |
|---|---|---|
| `task-5-codex-toml-mapping-brief.md` | `7fc0e1e87fe54f86460a4e25ea4224f4625696041aa94dffcf2ca541bf1e4bbb` | Complete normative mapper, parser, descriptor-walk, redaction, mapping, materialization, tests, and acceptance contract. |
| `task-5-codex-path-probe-brief.md` | `b9e64b25e6df6f4de8bc31993fe6a7d2dee40c0826ea0ef43bc78f9d2481b4d2` | D2 descriptor semantics and non-acceptance boundary. |
| `task-5-codex-path-probe-report.md` | `fb157b9adec0f1ac54cbd898d13ae13d005426f6b428a63444fcd5de8a95041e` | Accepted D2 source/build/binary identities and retained failure history. |
| `task-5-codex-path-probe-independent-review.md` | `145a72535236983907999163834b7d00ec167a6b2b1d5dbf2d83c1e76c0088f8` | D2 approval and evidence limits. |
| `task-5-codex-bridge-preflight.md` | `2c460af7dddbda4e10ca5c9bb021e93c8d69ff3031e2d805089fff85c2dabdf5` | Container/native mapping boundary and preserved protocol/context. |
| Multica `server/pkg/agent/codex.go` | Git commit `2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c` | Exact managed markers, rendering subset, and absent/empty/nonempty semantics. |
| `docs/development/runtime-isolation.md` | Bind the accepted post-refresh bytes at dispatch; currently observed SHA-256 `a4df46a0360c9ced40ac56f27134d43621d841950e1969da50db79a8b7a60ea0` | Existing runtime boundary and the sole allowed documentation update after focused review. |

The synthetic suite needs no native path or real TOML. It supplies a private
fixture descriptor with the exact D2 fields and pins: top-level binary SHA-256
`0e3f16bb910154660d5bc8c22b4e3de16f0a20504d8b79487a70c589f28eb5e3`,
descriptor source SHA-256
`30f0d4363e4ddafca0d2cb8a49e4807d7ee56da8374a9025add70cf1147dc2d8`,
build SHA-256
`4316863681f5378a5846cdb48ff49ccb49daeff353f5cdbeeab0740f0e4e8bbc`,
`read_status: "lexical_candidate"`, `cwd_matches_expected: true`, and
`canonical_identity` / `task_acceptance: "not_checked"`. Its candidate path,
expected cwd, workspace boundary, mode/owner cases, base policy, expected base
digest, output generation, roster, and TOML bytes are synthetic canaries.

The implementation contract already resolves the former choices: Python 3.9
standard library; bounded lexical guard plus renderer-subset parser; marker as
an exact final suffix; descriptor walk from `/`; `O_NONBLOCK` before the final
file `fstat`; UID 501 and no group/world write only from the private workspace
boundary; directories may be mode `0755`; exact `0600` regular config; ctime and
post-read held-FD revalidation; presence-only treatment for unknown/secret
fields; explicit-empty distinct from absent/inherited; and fixed Context7,
trace, and blocked-dynamic-Playwright mappings.

## Historical first-map input set

After implementation and independent review, the already approved historical
D2 map uses exactly this frozen admission bundle; it does not require another
native discovery run:

| Artifact | SHA-256 | Authority |
|---|---|---|
| `task-5-d2-native-descriptor-proof.json` | `ce4a23bdaa22c53363581b170eac0c234bb3c2a392ffdf24e09877295ba41ab2` | One allowlisted candidate from native run `01a09d1e-ab73-7dfe-8fbb-50862a0326df`; consume the candidate only after revalidating all pinned identities and status fields. |
| `task-5-d2-postrun-path-metadata.json` | `0cf042e7f74bdeb578fd51c050055ac49ba84bf1c2e2348fc1abe26370d4f176` | Preliminary lstat evidence for UID 501, directory mode `0755`, no named-component symlink, and regular `0600`/link-count-one/bounded config. It is not canonical identity or read authority. |
| `task-5-d2-native-cleanup-proof.json` | `0ca0811fb68899b23fc2b4461a79457ba6bf21dd121e595af897f8b68bc4586b` | Binds cleanup/restoration for that diagnostic; it is an admission record, never parser input. |

The real map must additionally receive coordinator-owned values that cannot be
precomputed: the pinned private workspace boundary and expected cwd; the
reviewed secret-free base policy file and its expected digest; mapping-policy
version; a fresh private output generation; source/AGENTS snapshot identity;
exact image/model/effort/tier and intended roster. Only `config.toml` beneath
the descriptor candidate may be opened by the approved held-descriptor walk.
The metadata artifact cannot substitute for that walk, and neither `auth.json`
nor a global/fallback home is an input.

## Remaining dispatch boundaries

- **Synthetic implementation:** ready after writer availability; create only
  `codex_toml_map.py`, its focused test, and the later reviewed documentation
  paragraph named by the approved brief.
- **Historical first map:** wait for mapper implementation/review and concrete
  coordinator base-policy/digest and generation values. These are execution
  artifacts, not unresolved design or owner input.
- **Codex tester launch:** remains blocked independently by static Playwright
  integration/acceptance and the actual authoritative roster. The mapper must
  truthfully emit `playwright_dynamic_npx` with `mapping_ready: false` until
  that closure exists.

The mapper may choose internal function names and a deterministic local CLI
envelope during TDD; its inputs, outputs, fixed failure enums, exit behavior,
and non-disclosure cases must be frozen in the focused tests and implementation
report. No cross-component scheduler or runtime integration change is required
for this milestone.
