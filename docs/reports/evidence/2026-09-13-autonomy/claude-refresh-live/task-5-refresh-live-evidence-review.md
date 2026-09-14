# Claude refresh — bounded live evidence review

**Verdict: PASS for the single authorized live refresh success path.** The retained evidence supports actual exchange, fresh candidate status validation, one fixed Opus validation invocation, publication and postflight cleanup using the accepted `6e197f8f42660da0fe7fd7c21c545f02ed156651` implementation. This closes the previously pending live success-path check for this transaction. It does not close automatic refresh integration or full native Agent Loop acceptance.

## Evidence support

All five supplied artifacts resolve to the `task-5-refresh-live-*` files in this scratch directory. Their check identity is consistently `claude-refresh-live-v1`, attempt `394771f72e5a4101bfcbe8795222cae5`.

| Claim | Evidence and assessment |
| --- | --- |
| Explicit, bounded authorization preceded exchange | `task-5-refresh-live-explicit-authorization.json` records user confirmation at `2026-09-14T01:03:55.046625Z`, limited to one saved-token exchange, candidate status and one fixed Opus request. It records that exchange had not started. |
| Reviewed implementation was prepared | `task-5-refresh-live-reviewed-preparation.json` pins commit `6e197f8f42660da0fe7fd7c21c545f02ed156651` and the accepted review SHA `eb464e03ebc58c7a7ab4023b161c61ea0018b1c1ec1c148afa7751c1ca4423e3`. Coordinator and runtime hashes match the frozen fix1 source identities already reviewed; the refresh worker hash remains the previously reviewed unchanged hash. Policy hash is `9c0a1086d0c999f229c3f2e3544316dd8708825f40c96c35c99d8d0fea9c1280`, also recorded in the live result. |
| Bootstrap preserved the original without exchanging | `task-5-refresh-live-bootstrap-proof.json` records `bootstrapped`, exit 0, original retained, no credential content inspection/hash, and `exchange_started: false` at `00:55:11.929878Z`. This was a separate prior preparation step; the later explicit authorization covers the live transaction. |
| One live transaction succeeded | `task-5-refresh-live-result.json` records start `01:04:30.073176Z`, end `01:04:39.887621Z`, elapsed 9.814 seconds, exit 0 and empty stderr. It records `published`, `generation_changed: true`, `model_accepted`, no blind retry and the accepted image `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a`. |
| Candidate passed the accepted success path | The accepted coordinator can publish a new candidate only after exchange recovery/quiescence, candidate validation, fresh authenticated status and accepted model validation. Thus the pinned coordinator's `published` result is evidence for those prerequisites, rather than an unsupported inference from a model's prose. The public result intentionally omits raw credential/status/model output. Opus 4.6 with medium effort, the fixed marker request, empty model tools and refresh-specific policy are bound by the reviewed code; effort and marker are not separately echoed in this sanitized artifact. |
| Publication and cleanup survived postflight | `task-5-refresh-live-postflight-proof.json` at `01:06:23.057719Z` records stage `published`, pointer matching candidate, worker quiescence confirmed, and successful absence checks with empty stderr for the last worker and all three exchange/status/model network and proxy pairs. Each operation records internal, isolated networking. The operations array is an inventory, not an execution chronology. Prior worker quiescence is also a prerequisite of each subsequent operation in the accepted fix1 coordinator. |
| Credential retention and source integrity remained intact | Postflight records old generation, published generation and original login as retained regular, private, single-link files; no credential values or hashes were recorded. It records source/policy hashes unchanged and no additional exchange/model invocation. These are metadata and controller observations; this reviewer did not inspect those files or live state. |

The complete successful transaction took less than any of the reviewed exchange/status/model deadlines (60/30/120 seconds), and returned without a timeout, overflow or retry result. Fixed argv, bounded internal output handling and secret redaction are supplied by the exact accepted implementation; these evidence files do not independently replay those negative cases. Previously accepted synthetic failure and recovery coverage remains the evidence for them.

## Usage and cost interpretation

The result records primary `claude-opus-4-6` usage and auxiliary `claude-haiku-4-5-20251001` usage. Opus reports 3 input tokens, 6,354 cache-creation input tokens and 13 output tokens; auxiliary Haiku reports 904 input and 19 output tokens. Reported list-price estimates are $0.06388 for Opus and $0.000999 for Haiku, total **$0.064879**. Both entries say `costBasis: list`, and `billingVerified` is false. Actual account billing/subscription treatment remains unknown. The auxiliary entry is disclosed; the proof is one fixed Opus validation invocation with reported auxiliary usage, not a claim that only one provider model appeared anywhere inside the CLI.

## Remaining integration boundaries

1. This proves a controller-invoked transaction with a valid saved credential. It does not prove future scheduled/on-demand refresh selection, expiry detection, renewed-token validity at a later expiry, or unattended recovery from an actual provider-side partial failure. Automatic invocation must use the accepted locking, generation-selection and uncertain-cleanup behavior; live failure retries have not been authorized by this success proof.
2. Publication and pointer identity do not themselves prove that the next real native checker selects the published generation. That path still needs evidence through the eventual adapter/provisioning integration. Original/old/new file retention does not establish rollback validity after a provider rotates credentials.
3. This credential canary uses the reviewed fixed request with model tools disabled. It does not establish native Claude context/import delivery, managed Trace/Context7 use, actual Stop-hook override behavior, or completion of the corresponding context/hook/native canary. Prior component proofs retain their own scope.
4. Persistent provisioning/source freshness, native run/actor binding, trusted collector process evidence, independent semantic review and gate admission/return/publication remain separate integration work. This result is not full Agent Loop acceptance and does not enable paused autopilots or change product statuses.

## Review scope and artifact identity

Evidence-only review against the already accepted frozen implementation: no new source review, tests, containers, APIs, native operations, provider/model requests, credential reads or state reads. No live operation was repeated. No new source findings were sought or raised.

Read artifacts and SHA-256:

- `task-5-refresh-live-result.json`: `f7d592a2b417160dd4e504ed85f28659e30aae1f310e4c61c30af803db896091`.
- `task-5-refresh-live-postflight-proof.json`: `33806deaa1191d991e085f7d3e60ec85c11a14d1cb22a879dfbb44543e241e1e`.
- `task-5-refresh-live-bootstrap-proof.json`: `3285f247a980eaeb4a11472062e16630c8094101ecffa1ff4860068eae14a2b8`.
- `task-5-refresh-live-reviewed-preparation.json`: `d7fdbd3dc1eab998e583e6c0f60064bc47bb49987c4094c800621934f3e73235`.
- `task-5-refresh-live-explicit-authorization.json`: read directly; authorization time/scope and identity recorded above.

The evidence consists of root-captured, sanitized observations tied to accepted code, not provider-signed receipts or independently repeated live measurements. Within that stated provenance, the claims are consistent and sufficient for this bounded success-path closure. No unresolved inconsistency blocks this evidence verdict.
