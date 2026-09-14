# Playwright canary recovery evidence review

Date: 2026-09-14  
Scope: the single consumed browser recovery invocation for attempt `410601918bb743a780236d78e35824f8`  
Verdict: **full check FAIL; navigation partial success independently confirmed**

## Evidence identity

- Recovery report SHA-256: `2522b2fe6b829d16f45acb74796f6a382694412f046b72b74b6ce71c271d1a2f`
- Recovery authorization SHA-256: `4dcac3a4ad07e153fc4e330b7f1785198d51ba41408e3063e8ccdde9843043a2`
- Invocation claim SHA-256: `85e343161d779a92fff8bdc9154a884cbcb218c2d651b14ec316daafe7df4223`
- Evidence-hash manifest SHA-256: `8f837a8ac50fcd23240d607e95fbb1829d14cb68d52fc4aef13a8cfdadf84483`
- Result SHA-256: `5d1cba7bddc051fd6f57317f83aeac767d42943832a05c4ebbae99940ab12714`
- Observed proof SHA-256: `a6686a0ea7aa075835662c684e4671c1b565bca10254207c6da4f73bb9fe0b5d`
- Protocol transcript SHA-256: `ac020e9c7615c1db2338d8d4684f8472b39e46b33b2ae52efdd160ead43922f5`
- Linked snapshot SHA-256: `f04e9fd7f885796009058a2db52cc1bb1eda9a2b0952d1c779c7e14b96be91a5`

The authorization permits one new invocation from consecutive failure count 2. The durable claim records one claimed invocation, the same attempt ID and authorization hash, the exact Python command, the isolated host environment, and Node `v24.12.0`. The saved start/result interval is `2026-09-14T08:43:57.830Z` through `2026-09-14T08:44:01.099Z`. No second canary-3 invocation is represented in this evidence package.

All ten `sources_before` hashes equal the ten `sources_after` hashes byte-for-byte. The candidate seccomp source and staged copy both bind to `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`; the fixed image remains `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`.

## Observed partial success

The control topology started and reached MCP initialize, tools/list, and request `id:3`. The exact `id:3` response reports:

- page URL `http://altera-web:3000/`;
- page title `Altera synthetic`;
- a link to `../runtime/evidence/playwright/page-2026-09-14T08-44-00-471Z.yml`.

The linked saved YAML contains heading `ALTERA_PLAYWRIGHT_CANARY` at ref `e2` and the `Continue` link at ref `e3`. The marker is therefore established by the linked file, not by inline response text.

This explains the immediate failure without converting it into acceptance. The harness asserted that the serialized `id:3` response itself included `ALTERA_PLAYWRIGHT_CANARY`; that response includes URL, title, and the snapshot link, so the assertion at `canary.mjs:205` failed even though the page and linked snapshot were produced.

Other pre-failure observations are preserved: the pinned package/browser inventory, Chromium headless-shell revision 1243 and binary hash, UID/GID 1000, exact seven-variable child environment, poison-preload non-execution, stdin echo, SIGTERM-to-exit-23 behavior, and MCP initialize/tools-list.

## Full-check result

The run is a **FAIL**:

- outer Python exit: 1;
- runner container exit: 1;
- MCP process closure: code 0, no signal;
- control accepted: false;
- acceptance topology started: false;
- acceptance receipt created: false.

The consecutive failure count advances **2 → 3**, and the stopped state remains in force. Click, fill, submit, screenshot, filesystem negatives, output limits, missing-browser/no-download controls, redirect/network negatives, process/sandbox evidence, and final browser inventory checks were not reached. The absence of the prior launch crash and the successful first page load do not establish complete Chromium sandbox or Playwright MCP acceptance.

## Cleanup evidence and limit

Commands 15–17 remove exactly:

- `altera-pw-dc9fd127115442a8b778794b31a72ee6-web`;
- `altera-pw-dc9fd127115442a8b778794b31a72ee6-runner`;
- `altera-pw-dc9fd127115442a8b778794b31a72ee6-sink`.

Each returns exit 0, its exact name on stdout, and empty stderr. Command 18 inspects network `altera-pw-dc9fd127115442a8b778794b31a72ee6` with exit 0 and records `Containers:{}`. Command 19 removes that exact network with exit 0, exact-name stdout, and empty stderr. The evidence also records shutdown of the synthetic host listener.

Cleanup is supported by the exact removal records and empty-network inspection. There is no separate post-removal Docker absence probe; `separate_absence_probe=false` must remain part of the disclosure. This review does not strengthen that evidence into a global absence claim.

## Review boundary

This evidence review neither accepts the Playwright milestone nor authorizes another recovery. It records a page-level partial success inside an overall failed check. Failure count 3 and the stop remain unchanged.

No test, CLI, Docker, container, browser, source edit, authentication, cache, native tool, Multica, model, index, or HEAD action was performed for this review.
