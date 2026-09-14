# Playwright action/observation offline fix

Base/HEAD `139954950e91c530772216975d1c85bce4bbd155`. Exactly two owned source files changed: `playwright-mcp-canary.mjs` and `test_playwright_mcp.py`. The prior root integrity manifest's ten pins matched before editing; eight other pins remain unchanged, including root's test_runtime whitespace pin `3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc`. Candidate seccomp e75, mapper/runtime, fixed vector and image97bd remain unchanged. No Docker/browser/model/auth/native/Multica, dependency/config, receipt, staging/commit or hooks. Root's same-check browser count remains4; no retry authority is consumed or implied.

## Confirmed cause and minimal fix

Saved canary4 id5 is successful `{content:[{type:"text",text:""}]}` from browser_type. Id4 supplies a form snapshot with Name and Submit; no fresh full snapshot is promised by id5. The former pipeline replaces the page with the empty action response and then cannot find Submit.

`actionObservation` now awaits action completion, rejects error replies/rejected promises, then explicitly calls `browser_snapshot` with `{}` and only observes that successful fresh result. All four navigation/Continue-click/type/Submit-click page-producing call sites use this flow. No previous action text or references are merged or retained. The already accepted inline/linked bounded snapshot reader is unchanged. `browser_snapshot` is now in the exact required tool inventory shared by initialize and the offline contract.

## Evidence

Tests copy actual canary4 id4/id5 responses and the exact form YAML as synthetic fixtures; source-proof verifies their equality with saved evidence. Expected RED applies the existing observer to the actual empty action success and fails the Submit-content assertion, not a missing helper/module or browser launch. Focused GREEN exercises actual async helper orchestration with an asynchronously completed fake action followed by a fresh snapshot. It covers empty navigation/click/type success, inline/linked snapshots, a stale action Submit ref that must not be retained, action error/rejection preventing any snapshot request/read, and snapshot error preventing observation.

Final static suite6/6 passes once. Focused1/1 GREEN passes. Exact commands/exits/raw-log hashes are in `playwright-static/action-observation-fix/commands-and-results.json`; `red.log`, `green.log`, `covering.log` preserve all outputs. No unexpected local test failure; expected RED is separate from stopped actual browser count4. No unchanged runtime/mapper suite rerun.

## Remaining calls inspected read-only

Saved pinned tools/list confirms `browser_snapshot` accepts `{}` (no required properties), browser_close accepts `{}`, navigation requires URL, click/type use the corrected target fields, screenshot requires scale and the current builder supplies png/css. No additional concrete request-schema mismatch was found in those actual calls. This is saved-schema evidence, not future response acceptance.

Concrete remaining risk: redirect control stores `/count` in report.sink and then sets sinkReachable=true after a successful fetch, but does not require `hits > 0` or successful redirect navigation. It therefore proves a reachable control endpoint, not that the browser actually reached the forbidden sink. That assertion weakness was not edited in this bounded action-response fix and should not be treated as a positive browser redirect control without further review.

Other actual checks remain unexecuted: the new explicit browser_snapshot response after each mutation, post-submit URL/title/marker shape, live screenshot/filesystem-denial classifier wording, output eviction/limit behavior, process/capability inspection, missing-browser error wording, redirect/network negatives and final inventory/profile cleanup. No live PASS is inferred from the async fixtures. The post-submit assertion requires `/done?name=Ada` in the fresh snapshot response; actual browser_snapshot response metadata has not yet been observed in this run. These uncertainties do not authorize further calls or edits.

## Frozen review package

`playwright-static/action-observation-fix/action-observation-only.diff`: 9641 bytes, SHA256 `33a97e69da1b7fc50197b8d015835069ba577c053b685aa2f8d0f0b92daf61c8`. `source-proof.json` records before/after files, eight unchanged pins, fixture provenance, unchanged snapshot/classifier checks and the four actual action sites. `.before` copies preserve prior checkpoint. Source writer released for independent scoped review. No general observation framework, CLI/vector/security change, accepted receipt or native acceptance is claimed.
