# Playwright canary 4 evidence review

Date: 2026-09-14  
Scope: the single approved canary 4 invocation, attempt `880d525a2c7c47178f9c91303bb0a2b3`  
Verdict: **overall FAIL; partial navigation/click/type protocol progress confirmed**

## Frozen evidence

- Run report SHA-256: `130f58da7f7ae063ddf18f4174c15720cd1e49b2aac1872424f79dc5bdbf5f53`
- Archive manifest: `docs/reports/evidence/2026-09-13-autonomy/playwright-recovery-2/manifest.json`
- Manifest SHA-256: `4fb568c6a1c15f19aaee67175128858626ea7a903d57bb716d2f1effc0d06de2`
- Manifest state: `single_authorized_canary4_failed_count4_no_receipt`
- Manifest integrity: **59/59** explicit rows exist and match both declared byte count and SHA-256; no missing or mismatched row was found.
- Authorization SHA-256: `8e31f27833bfb0c5ef335d8cfee29219d792119335f3c757e59965c87efbed9b`
- Invocation claim SHA-256: `6c992b05781ff3f45153589e196f55a70c3e1ef3af49ff344eca41cebfdc3c89`
- Result SHA-256: `b9132af87cb36284158e86d43991fc094506ba86087eefe1d1b64787ec5329e8`

The authorization permits one invocation from failure count 3. The durable claim consumes one invocation and has the same attempt ID. Authorization sources, claim `sources_before`, and result `sources_after` are exactly equal for all ten pinned files; the result records `sources_unchanged=true`. The image remains `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`, and the candidate seccomp pin remains `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`.

## Observed protocol progress

- Response `id:3` reports URL `http://altera-web:3000/`, title `Altera synthetic`, and links `page-2026-09-14T09-29-06-646Z.yml`. That saved YAML contains heading `ALTERA_PLAYWRIGHT_CANARY` and `Continue` ref `e3`.
- Response `id:4` reports URL `http://altera-web:3000/form`, title `Form`, and links `page-2026-09-14T09-29-07-217Z.yml`. That saved YAML contains textbox `Name` ref `f1e4` and button `Submit` ref `f1e5`.
- Response `id:5`, the type action, is a successful JSON-RPC result whose sole text item is the empty string.

The saved evidence therefore proves successful home navigation, linked-home observation, Continue progression to the form, linked-form observation, and successful completion of the type RPC. It does **not** prove the input's DOM value: `id:5` contains no snapshot or value, and no later page observation was made.

The harness replaced the prior linked-form observation with the empty action response, then failed with `missing accessible reference:Submit`. The Submit reference exists in the saved `id:4` form snapshot; it is absent from the empty `id:5` response. This is consistent with the reported action/observation handling defect.

## Full-check result

- outer harness exit: 1;
- runner exit: 1, no OOM and no runtime state error;
- MCP closure: code 0, no signal;
- control accepted: false;
- acceptance topology started: false;
- receipt created: false;
- consecutive failures: **3 → 4**;
- stopped state: true.

Form submission, screenshot, later filesystem/network negatives, process/sandbox evidence, and final acceptance checks were not reached. The observed partial steps do not establish browser or Playwright MCP acceptance.

## Cleanup evidence and limit

Commands 15–17 remove exactly the web, runner, and sink containers under prefix `altera-pw-61749a5e21bf411cb32a7ee685ad7c96`. Each records exit 0, exact-name stdout, and empty stderr. Command 18 inspects that exact network with exit 0 and records `Containers:{}`. Command 19 removes the exact network with exit 0, exact-name stdout, and empty stderr.

There is no separate post-removal absence probe. The evidence supports the exact removals and empty-network observation, not a broader final-absence claim.

## Review boundary

This review preserves the overall failed and stopped result. It grants no acceptance and no new recovery authority.

No run, test, CLI, Docker, browser, model, authentication, native tool, Multica, source edit, staging, commit, index, or HEAD action was performed for this review.
