# Spec Compliance

❌ **Issues found — two Important findings.** The nine-file implementation follows the refresh/store/model design, but cleanup is not a verified prerequisite for candidate recovery, and policy bytes are hashed before the required hardlink/owner/mode validation. Both require correction before a live refresh.

**Task quality: Needs fixes.** Whole-branch and live/native acceptance are separate; this review grants neither.

## Review identity and scope

- Base `945397d47481d20c928b6779f98d5b5ab2c7cbbf`; head `40a43e874799e4be4701d4ef4441bd81809466b7`.
- Reviewed `refresh-review/committed-review.diff`, 97,634 bytes, SHA-256 `ece5455bb161cb5503e9d987549e2e83883d65c831987388db726104ed6b3ff5`, once in sequential manageable chunks. All nine owned paths have corresponding hunks.
- Read implementation brief, root rulings, schema proof, implementation report, source manifest and commit proof. Root supplemental rulings govern optional clientId, fixed bounds, opaque bootstrap and exact model-result acceptance; obsolete pending/authorization phrases were not treated as current blockers.
- All nine frozen source byte counts and SHA-256 values match `refresh-review/source-manifest.json`. Commit proof identifies the requested head/scope and empty index; no Git command, index/HEAD change or broader source crawl was performed.
- Trace execution-path outline was attempted and rejected `SECURITY_VIOLATION`; the supplied immutable diff was used. Outside-diff examination was limited to the two named-risk synthetic probes below and exact symbol/line metadata from their frozen modules.

Binding constraints retained verbatim: «Один implementer одновременно; независимый reviewer не создаёт проверяемую реализацию. Две подряд неуспешные попытки одной проверки останавливают эту проверку; счёт не сбрасывается новым run. Проверки привязаны к точной ревизии и dirty diff. Не читать и не выводить секреты. Реальное ограничение runtime нельзя подменять промптом. Неподтверждённые возможности и стоимость обозначать неизвестными.»

## Strengths

- `credential_refresh.py:136–161,237–284` uses the same exclusive lock for generation selection and bootstrap/refresh, descriptor-relative no-follow opens, regular-file/single-link/owner/mode checks, and opaque bootstrap copying. Existing source is retained; the host does not parse/hash credential payloads in that bootstrap path.
- `credential_refresh.py:324–385` persists `exchange_started` before invoking the runner. Missing/ambiguous candidate after an irreversible attempt does not re-exchange the old token; accepted-candidate and pointer-before-journal recovery avoid another container invocation. Candidate file/directory fsync precedes the next journal stage; pointer publication uses atomic replacement and parent fsync (`:177–194,311–322`).
- `claude-refresh.mjs:6–89,94–143` fixes schema/bounds, rejects duplicate keys and guessed aliases, preserves optional clientId exactly in the fixed exchange child's environment, and gives status/model children a newly constructed environment without those fields.
- `claude-refresh.mjs:94–117,145–240` keeps exchange, status and model distinct. The model command uses explicit Opus4.6/medium, empty built-in tools/MCP and disabled hooks. Acceptance requires actual child exit zero, exact marker/is_error/result shape and approved canonical model metadata; auxiliary Haiku and list-price usage are retained without billing claims.
- `runtime.py:236–240,259–315` extracts the ordinary Docker prefix without changing its argument order and builds a separate refresh operation with no source checkout, stdin, host HOME, Multica token or socket mounts. The old file is RO for exchange; fresh status/model receive only candidate RO. Ordinary-command equivalence has explicit retained vectors and a covering pass.
- Tests include real cross-process lock contention and actual Docker synthetic success, failure, output overflow, inherited-pipe timeout and controlled transport interruption. They do not claim fake exchange/model output as live provider acceptance.

## Issues

### Critical

None identified within this task scope.

### Important — R1: Preserve uncertain worker cleanup and block candidate acceptance until quiescence is established

**Locations:** `scripts/agent-runtime/credential_refresh.py:406–412` (`container` cleanup), `:324–385` (`refresh` recovery); coverage gap in `scripts/agent-runtime/test_credential_refresh.py:287–318`.

`docker rm --force NAME` uses `check=False` and its result is discarded. If it fails while the worker remains alive, the coordinator can kill only the Docker client, continue proxy cleanup and return an ordinary timeout/failure. The exact worker name exists only in local memory, not durable recovery state. A later `refresh()` accepts an existing metadata-valid candidate and runs status/model/publication without proving that the preceding worker stopped. Abrupt coordinator death has the same missing durable-worker-identity problem.

This is materially different from the acknowledged limitation that a nonresponsive Docker daemon cannot be forcibly repaired: the implementation must preserve uncertainty and refuse further candidate acceptance, not proceed as though cleanup succeeded. A still-live exchange worker retains candidate write authority; neither the store lock held by the next coordinator nor a fresh status/model container removes that authority.

**Focused evidence:** `task-5-refresh-review-cleanup-proof.json`, using frozen coordinator SHA `4c76cbd339e58f7a69b1306dde4ce13d09ade9c2ee435a515d007e5a68bdf0c8`. With only synthetic files and mocked Docker transport, the modeled worker writes a candidate, client communication times out, exact worker removal returns nonzero, and killing the client leaves the modeled worker alive. First call returns `candidate_recovery_required`; second call runs status/model and returns `published`, with pointer changed while the modeled worker remains live. Calls are exactly exchange/status/model — this is not an old-token re-exchange finding. No actual Docker, provider, model or credential was used.

**Required correction:** durably bind the generated worker identity to the operation before launch and retain an unresolved cleanup outcome. Before status/model/publication or recovery, establish terminal/absent state for precisely that worker; otherwise stop with the candidate/journal retained. Treat already-auto-removed `--rm` containers correctly: a nonzero removal command alone is neither proof of survival nor proof of absence. Do not broaden cleanup to unrelated containers or retry exchange. Add focused failed-removal/unknown-cleanup and interrupted-coordinator recovery coverage; successful cleanup tests already exist.

### Important — R2: Validate policy file metadata before hashing or parsing its contents

**Location:** `scripts/agent-runtime/runtime.py:275–283` in the new `refresh_command`.

The function calls `tree_hash(policy)` at line 275 and parses the two policy JSON files before the loop at lines 280–283 checks policy files for regular type, single link, owner and writable permissions. Thus a disallowed hardlink under an expected policy basename is read and hashed on the host before it is rejected. The brief requires unsafe metadata to be rejected before use and forbids host credential/token-derived hashing. Directory ownership and a manifest hash do not replace the per-file check that this code itself requires.

**Focused evidence:** `task-5-refresh-review-policy-proof.json`, using frozen runtime SHA `0c0a6d3572c1fdca20c624a5d034f0ed5b36d1a86e9d1602696cde187ddd4ae7`. A wholly synthetic private file was hard-linked as `policy/claude-refresh.mjs`. A digest observer confirmed those bytes were hashed during `refresh_command`; only afterward did the function raise `unsafe_refresh_policy`. The proof stores booleans/metadata, not fixture content or its digest. No real credential was read or hashed.

**Required correction:** validate the exact policy entries' no-follow/type/link/owner/mode metadata before any content hash/JSON read; preferably keep validated descriptors/identities through the read so normal replacement races also fail closed. Apply this to the new refresh policy path only; no general hardening rewrite of previously accepted runtime components is requested. Add a regression asserting rejection occurs before digest/read of a disallowed hardlink.

### Minor

No additional actionable minor findings. Existing package-hook todo/skipped-file counts are retained limitations, not new refresh coverage and not a clean whole-product acceptance claim.

## Evidence assessment

Read retained raw output, without rerunning any suite:

| Evidence | Observed result / limit |
| --- | --- |
| `task-5-refresh-runtime-covering.log` | 21/21 passed, including ordinary command-vector equivalence and dedicated refresh mounts. |
| `task-5-refresh-wrapper-covering.log` | 4/4 passed, zero skipped/todo/cancelled. |
| `task-5-refresh-store-final.log` | 17/17 passed, including cleanup order/watchdog/exception paths; no failed-removal/quiescence recovery scenario. |
| `task-5-refresh-docker-success-2.log` | Actual synthetic Docker exchange/status/model and interrupted accepted publication passed; fake model, not provider acceptance. |
| `task-5-refresh-docker-failure-bounds-1.log` | Failure/no-retry and real fixed 60-second timeout passed; overflow fixture failed reading its empty diagnostic JSON. Failure retained. |
| `task-5-refresh-docker-overflow-2.log` | Corrected focused overflow case passed with exact output-limit result. |
| `task-5-refresh-pinned-compatibility-1.log` | Actual pinned CLI invalid synthetic token selected refresh branch; no browser handoff, expected exchange failure, internal isolated network/proxy RO evidence. Does not prove a successful live exchange or specific remote provider response. |
| `task-5-refresh-docker-cleanup-1.log` | Real controlled transport interruption removed the known worker and did not re-exchange. This is the successful-removal path; it does not answer R1. |

Final coordinator coverage follows the cleanup code change. Earlier wrapper/compatibility results precede formatting-only changes; frozen hashes, report sequence and final Docker interruption evidence preserve that limit. Historical administrative/fixture failures were retained and corrected; this review neither resets existing counters nor treats expected hook/TDD stimuli as real failures.

## Assessment and acceptance limits

**Spec verdict: Issues found. Quality verdict: Needs fixes.** The implementation has a sound small-file store/child separation and useful synthetic evidence. The two boundary-ordering defects must be corrected before using real credentials: recovery must not accept a candidate while a prior writer may still run, and invalid policy references must be rejected before their contents are hashed.

⚠️ Actual opaque bootstrap, live token exchange, fresh candidate status, fixed real Opus model acceptance, deployed cleanup behavior on a failure, and full native/context/MCP/hook integration remain unverified here and are expressly separate operations. Current review does not authorize them. Same-UID hostile modification of trusted code/store remains the declared trust limitation; neither finding asks to solve that general threat model.

Only two new named-risk synthetic probes were executed, each once. Their observed unsafe outcomes are retained evidence for this first independent review; no implementation/source/index/HEAD, actual credentials, native/profile state or provider was changed, and no subagent was used.
