# Refresh fix round 1 — exact independent findings

Base 40a43e874799e4be4701d4ef4441bd81809466b7. Original nine-file scope remains binding.
Read task-5-refresh-independent-review.md for both Important findings R1 and R2 verbatim,
and original implementation brief/root rulings/schema proof. Fix both before live work.

R1: durably bind the generated worker identity to the operation before launch and retain
an unresolved cleanup outcome. Before status/model/publication or recovery, establish
terminal/absent state for precisely that worker; otherwise stop with candidate/journal
retained. A nonzero rm result alone proves neither survival nor absence because --rm
may already have removed the worker. No broad cleanup, old-token reexchange, Docker
socket in model, scheduler or detached poller. The root authorizes the smallest nonsecret
journal worker identity/operation/unconfirmed state needed to satisfy this invariant.
Preserve unknown state across coordinator interruption; do not silently migrate a
pending old-format journal into accepted quiescence. No actual live store exists yet.

R2: validate exact refresh policy entries with no-follow/type/link/owner/mode checks before
any content hash or JSON parse. Keep validated descriptors/identities through bounded
read and revalidate normal replacement races. Do not rewrite the accepted general
runtime policy or fingerprint mechanisms. Add meaningful rejection-before-read/digest
regression for synthetic hardlink and focused normal replacement if new handling needs it.

Focused validation only: test_credential_refresh.py for R1, test_runtime.py for R2 and
ordinary boundary, plus one targeted no-model/no-provider synthetic Docker cleanup
recovery if required by the changed command handling. Do not rerun prior 60s timeout,
provider compatibility or wrapper suite if those interfaces remain unchanged. Retain
meaningful RED/GREEN, raw commands/results and existing counters. Failed cleanup probe
is a defect reproduction, not authorization to repeat a token exchange.

Append fix report to task-5-refresh-implementation-report.md with exact changed files,
commands/output/raw paths, source hashes and remaining limits. Freeze fix diff from
40a43e8 to own commit, normal hooks, index empty; do not stage root docs/evidence.
No real credentials/model/native/profile/API operations. No subagents. Root source
staging at40a43e8 remains unaccepted and will be superseded after accepted fix.
