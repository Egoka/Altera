# Namespace-aware browser capability check — offline fix

Base/HEAD `139954950e91c530772216975d1c85bce4bbd155`. Exactly the canary JavaScript and its static Python test changed. Eight other source pins match root's release manifest, including test_runtime3625. Snapshot/action/current-metadata helpers, screenshot classifier, full browser flow except the process-diagnostic call, exact binary vector/image/seccomp/runtime/package/receipt code are unchanged. No Docker/browser/model/auth/native/Multica/source-config operation, image build, security expansion, staging/commit/hooks or receipt. Actual same-check browser failure count remains5; root reports two invocations remain in the authorized package, but none was run here.

## Saved evidence and agreed rule

Canary5's saved protocol actually proves Name input Ada (id8), destination `/done?name=Ada` and completion marker (id9/10). Its failure only records CapEff `0000000000200000`; the offending PID/role/namespace row was lost. Therefore the old failure cannot be retrospectively classified as an acceptable inner zygote.

The reviewed [Chromium source](https://chromium.googlesource.com/chromium/src/+/0b7f48c4c5b7dff843b70f17c41dd595d3d74321/sandbox/policy/linux/sandbox_linux.cc) moves into a user namespace before retaining SYS_ADMIN for a zygote to create child PID namespaces (lines563–580). This is rationale for the root-approved conditional criterion, not actual process identity evidence or exact current binary attribution. Root explicitly approved inner/outer map1000→1000 length1, namespace-local bounding-set handling and retaining legitimate --no-zygote-sandbox.

## Collect and persist before validation

The canary first collects its observer and every matched chrome-headless-shell row; it assigns the whole structure into report.browser_processes and persists `/runtime/evidence/browser-processes.json` before any isolation assertions. A validation failure therefore retains the offending row both in that artifact and the final canary report.

Captured fields are exactly argv/PID/starttime; four Uid/Gid values; CapEff/Prm/Inh/Amb/Bnd; NoNewPrivs/Seccomp/Seccomp_filters; NSpid; uid_map/gid_map; and user namespace readlink or fixed error code. Reads are bounded:128 PID entries, cmdline16KiB, status64KiB, stat/maps4KiB; no environment reads or privilege changes. Missing/malformed/raced matched rows retain partial data/error codes and refuse. Starttime/status/maps/namespace outcome/argv are reread to detect observed replacement; this is bounded consistency evidence, not a claim of a perfectly atomic procfs snapshot. ENOENT before a PID is identified as a browser is skipped; other scan errors refuse, and any matched-row read failure remains diagnostic.

## Acceptance predicate

Observer UID/GID fields must all be1000, all five capability sets zero, NNP1/Seccomp2, positive filter count, valid NSpid, valid namespace identity and readable mapping records. Every browser row must use the exact inventory-pinned argv0, UID/GID1000, NNP1/Seccomp2 and valid fields. --no-sandbox (including explicit equals forms) refuses; --no-zygote-sandbox is retained/recorded rather than conflated with it.

The default/outer path requires all five capability sets zero and observer-equivalent maps. A nonzero or broader bounding-set exception needs independently proven inner namespace plus exactly one UID and GID map each `[1000,1000,1]`. Readable same namespace identity forbids that exception. Readable different identity plus narrow maps proves inner separation. If readlink returns EACCES, both narrow maps must independently differ from valid observer maps; missing identity alone, equal narrow maps, unknown map, outer0, inner0, range or malformed maps never authorizes an exception. All-zero rows with observer-equivalent maps do not gain any capability exception from an unavailable namespace identity.

Within a proven inner namespace, Inh/Amb remain0; all non-zygote roles require Eff/Prm0. Only exactly one `--type=zygote` role can carry the exact SYS_ADMIN bit0x200000 in both Eff and Prm, with no other effective/permitted bits. Inner CapBnd is recorded as namespace-local potential, not treated as an effective/permitted grant or required to be0. Every outer/observer CapBnd must still be0. A renderer with zero effective/permitted capabilities is mandatory. This interprets the existing container cap-dropALL correctly; it adds no capability or namespace privileges.

## Meaningful tests

Expected RED executes the old actual CapEff assertion against a synthetic fully constrained inner-zygote row and reproduces its refusal. Focused GREEN checks the actual new predicate: proven inner zygote/renderer and EACCES plus distinct maps pass; shared/ambiguous namespaces, root/range/missing maps, outer/observer bounds, outer or renderer admin, extra/ambient/inheritable bits, wrong UID/binary, no-sandbox, missing renderer, and race errors refuse. Exact /proc-shaped temporary fixtures exercise the real collector and persist-before-assert wrapper; the offending extra-bit row survives the refusal with its map/cap fields. No host procfs namespace operation or actual browser is involved.

Focused1/1 passed; final changed static suite8/8 passed once. Before covering, self-review added argv/namespace consistency rereads and explicit outer-bounding/equal-narrow-map negatives. No unexpected local check failure; expected RED is separate from actual count5. Exact argv/results/raw hashes: `playwright-static/namespace-capability-fix/commands-and-results.json`; raw `red.log`, `green.log`, `covering.log` same directory. No unrelated suite reruns.

## Frozen package and limits

`playwright-static/namespace-capability-fix/namespace-capability-only.diff`: 17537 bytes, SHA256 `1366ce0375ce3beb87ed013dd87fbc9ae6f471b76b0d81d39528817a4b95b369`. `source-proof.json` binds two before/after files, eight unchanged pins and checks; `.before` copies retain the prior state. Source writer released for independent scoped review. Actual new diagnostic rows and map/namespace readability remain unknown until root's separately released invocation. If the fixed namespace/map/capability criterion is not proven then, it fails closed; no guessing, permission widening or automatic retry is authorized by this offline fix.
