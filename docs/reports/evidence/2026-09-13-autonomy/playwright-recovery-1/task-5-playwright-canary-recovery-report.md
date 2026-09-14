# Playwright browser recovery — STOP at count3

Exactly one invocation of the same `playwright canary` check was consumed under authorization attempt `410601918bb743a780236d78e35824f8`. Durable claim was saved before start outside the model RW directories. All10 source pins and3 independent review pins matched before launch; all10 source pins matched afterward. No source/index/HEAD edits, build/install, auth/model/native/Multica/managed-config actions or receipt occurred.

Host orchestrator: pinned Nodev24.12.0. Start `2026-09-14T08:43:57.830Z`; finish `2026-09-14T08:44:01.099Z`. Exact Python command and minimal host env are in `playwright-static/canary-3-command.json` / `canary-3-env.json`; the harness uses its own fixed sanitized Docker env. Image `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`; staged seccomp matches before/after `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`.

## Actual result

Outer Python exit1, runner container exit1, MCP closure `{code:0,signal:null}`. These are distinct. Control topology started; acceptance topology never started. The full canary failed and the consecutive counter advances2→3. `failure-history.json` preserves both earlier failures and appends this one. No follow-up execution or retry was performed.

Actual assertions passed before the failure: exact package/browser inventory (same installed browser revision1243 and binary hash), nonrootUID/GID1000, exact seven child environment names/values, poison preload non-execution, stdin echo, SIGTERM mapped to child exit23, MCP initialize/tools-list. Actual first navigation succeeded: response id3 reports URL `http://altera-web:3000/` and title `Altera synthetic`. It returns a snapshot link `../runtime/evidence/playwright/page-2026-09-14T08-44-00-471Z.yml`, rather than inline snapshot text. The saved file contains heading `ALTERA_PLAYWRIGHT_CANARY` and Continue link ref=e3. The harness assertion `text(page).includes('ALTERA_PLAYWRIGHT_CANARY')` at canary.mjs205 therefore fails despite a successfully loaded page. This is concrete saved-output evidence of the assumption mismatch; no fix or further browser request was attempted.

The original chroot launch crash was not observed in this response and the page loaded, but this does not establish complete sandbox/browser acceptance. Click/fill/submit, screenshot and filesystem negatives, output limits, missing-browser/no-download controls, redirect/network negatives, process/sandbox evidence and final browser inventory assertions were not reached. No accepted receipt or full static milestone claim is valid.

## Cleanup evidence

Exact created prefix `altera-pw-dc9fd127115442a8b778794b31a72ee6`. Recorded Docker commands15/16/17 each remove the exact web/runner/sink container with exit0 and matching name stdout, empty stderr. Command18 inspects the exact network and records `Containers:{}`. Command19 removes that network with exit0 and matching name stdout, empty stderr. The harness finally also shuts down its host synthetic listener. No extra Docker inspection/absence command was run after the stopped invocation. Thus saved removal and empty-network evidence is confirmed, without claiming a separate final absence probe. The source-profile hashes remained unchanged; staged profile independently rehashed after failure because the harness's post-success assertion was not reached.

## Exact evidence paths

All relative paths below start from this plan scratch directory:

- `playwright-static/canary-3-invocation-claim.json`: one-time claim, authorization hash, before sources, command/env.
- `playwright-static/canary-3-started.json`, `canary-3-result.json`, `canary-3.log`: timing, exit/after sources/counter, full host traceback.
- `playwright-static/canary-3-observed-proof.json`: bounded actual result/cleanup projection.
- `playwright-static/canary-3/commands.json`: all19 exact Docker vectors and exits, with adjacent numbered raw stdout/stderr files.
- `playwright-static/canary-3/control/evidence/canary-report.json`, `main-protocol.jsonl`, `main-stderr.log`: inventory/env/protocol and exact failed assertion; main stderr empty, not a browser success criterion.
- `playwright-static/canary-3/control/evidence/playwright/page-2026-09-14T08-44-00-471Z.yml`: actual page snapshot with marker.
- `playwright-static/canary-3/control/container-inspect.json`, `exit.json`, `network-inspect.json`: exact runtime inputs and terminal state.
- `playwright-static/canary-3/docker-15.stdout` through `docker-19.stderr`: saved exact cleanup commands' raw results.
- `playwright-static/canary-3-evidence-hashes.json`: frozen hashes of claim/command/env/result/proof/protocol/snapshot/profile/runtime/cleanup evidence.

No source writer was acquired. Review/diagnosis may use saved evidence; count3 stop remains in force and no further execution or source edit is authorized by this completed invocation.
