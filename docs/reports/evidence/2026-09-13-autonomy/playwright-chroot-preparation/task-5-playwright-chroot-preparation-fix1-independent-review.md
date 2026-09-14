# Playwright chroot preparation fix1 independent review

Date: 2026-09-14  
Scope: static re-review of preparation R1 only, plus fix-introduced breakage  
Verdict: **PASS — R1 ADDRESSED**

## Reviewed frozen evidence

- Preparation report: `playwright-chroot-preparation/task-5-playwright-chroot-preparation-report.md`
  - expected and observed SHA-256: `042f1811532c998fda09239d48ffc45b00339653cce5df40d242a018dddd7336`
- Fix-only diff: `playwright-chroot-preparation/fix1/fix-only.diff`
  - expected and observed SHA-256: `2a96038dbe37d2083850aa738794fa4dacdaecdf82663b23bbe33f90aa1590c7`
- Saved static proof: `playwright-chroot-preparation/fix1/static-proof.json`
  - observed SHA-256: `6c71e0a0bb19e33ac07f3e360674445ce2a2b20d5f0dadaa1ce997dd6dff487e`
- Refreshed frozen manifest: `playwright-chroot-preparation/frozen-hashes.json`
  - observed SHA-256: `67e5347df6c37cbc436db97619a1734951fb97e6039e1ee3b59882b45b5c8048`
- Current commands: `playwright-chroot-preparation/commands.json`
  - expected and observed SHA-256: `3e61e70d2e0d5d5cac9caa14eb23acc4082087608bfbb14d1232493776740b79`

The refreshed manifest also binds the unchanged artifacts:

- control profile: `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140`
- candidate profile: `e75c6400...024f1`
- probe: `64eaccb7...b29`
- synthetic test: `9fdcf03a...0a9f`

The abbreviated values above are reproduced exactly as the already frozen artifact identities in the reviewed manifest; this review did not regenerate them.

## R1 disposition

**ADDRESSED.** The anonymous `docker run --rm` identity preflight was replaced by a bounded, named lifecycle with:

- an exact fixed name and a pre-existence refusal gate;
- separate create, inspect, start-and-attach, post-run inspect, remove, and final absence stages;
- a 15-second outer timeout and bounded output at every stage;
- exact created-container ID and configuration validation before start;
- stopped-state, exit-code-zero, no-OOM, and empty-runtime-error validation after execution;
- coordinator-owned `finally` cleanup after every successful create path;
- required final absence even when an earlier post-create stage fails;
- refusal to remove a pre-existing object with the selected name.

This closes the interruption and quiescence gap identified in the first review. The container cannot be admitted from an anonymous transient run, and a created object has an explicit cleanup obligation and observable terminal state.

## Fix-breakage review

No fix-introduced preparation defect was found.

- Canonicalized comparison after removing `runtime_identity_preflight` is identical between the before and fix1 command documents.
- The accepted image, platform, `network=none`, read-only root filesystem, non-root user, `cap-drop=ALL`, `no-new-privileges`, PID/memory/CPU limits, mounts/devices/ports exclusions, Node expression, and result schema are preserved.
- Candidate and control profiles, probe, two-arm commands, and arm lifecycle remain byte-identical to their frozen identities.
- The preflight admits only an exact `/usr/bin/perl` canonical regular executable with the required digest and AArch64 ELF identity; mismatch is refusal, with no substitution or fallback.
- Saved `static-proof.json` records no Docker execution and confirms the sole changed manifest section and preservation checks.

The name-based remove command is sufficiently bound by the pre-absence gate, the non-auto-remove create, and exact ID/name post-inspection. A second object cannot acquire that name while the created object exists. The trusted coordinator must still implement the declared gates and unconditional post-create cleanup exactly; this static review does not itself prove coordinator execution.

## Preparation verdict and remaining boundary

The corrected built-in-seccomp runtime identity preflight is **ready for root to execute** under the already authorized read-only preparation scope. This verdict covers the frozen command package and its lifecycle only.

The following remain unknown or unauthorized:

- `/usr/bin/perl` identity and behavior in the accepted image remain unknown until the corrected baseline identity preflight runs.
- The candidate and control profile arms have not been executed.
- The expanded `chroot` profile has not been authorized for execution.
- Chromium sandbox and Playwright MCP acceptance have not been run or established.
- The stopped browser-canary failure count remains **2**; this review does not reset or recover that check.

No tests, containers, syscalls, browsers, authentication, models, native tools, APIs, source changes, index changes, or HEAD changes were performed for this review.
