# Task 8 — independent actual Playwright runtime acceptance review

**PASS for the bounded fixture Playwright runtime receipt criteria.** Actual control and acceptance both pass on the exact previously reviewed source. No blocking scoped evidence finding remains. This verdict permits the controller to use this evidence for the corresponding fixture receipt; it is not a receipt issuance, native adapter/model acceptance, or whole Agent Loop completion.

## Identity and evidence integrity

Reviewed archive `docs/reports/evidence/2026-09-14-runtime-native/runtime-acceptance-8`. Independently verified all **112** manifest entries by byte length and SHA256. Manifest SHA256: `325ba3f811efa7f9919b2885b9749314684658539425912658631493e6651563`.

Claim/result identify newly authorized attempt `b1047ebf65ce4cd3823fb1015adab311`, invocation8, from 2026-09-14 10:41:53 to 10:42:10 UTC, exit0. Prior seven failures and the exhausted old package are retained; this is a new explicitly authorized run, not retrospective acceptance of canary7. Both archived executed canaries equal source SHA256 `6d90fc348b6be0d7970e4883db1dc1fdad4b45635e9f086a224f494cc298b030`; test SHA256 is `0ac10c0d9de73f4f1df22d89d16c11c262087fc19b13d08214bdb39c86adedf1`. All ten claim source pins independently match current source. Image remains `sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426`; seccomp remains `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`. Captured Docker seccomp JSON semantically equals that exact saved profile.

This was an evidence review, not a new source audit. Trace outline preceded the narrow inspection of the archived `envProof`/client shutdown span needed to interpret stdio/signal evidence. No suite, browser, Docker, model, auth, API or native operation was rerun.

## Actual behavior

The raw protocol in both modes records Ada entered in Name, `/done?name=Ada`, and the fresh completion marker. Each mode produces a 10,025-byte PNG with a valid PNG signature and 1280×720 dimensions; output eviction is recorded, with total retained output below 16 MiB. Source/relative screenshots fail EROFS, policy screenshot is denied outside allowed roots, and direct writes to source, policy, package/browser trees and root fail EROFS. Captured source/policy hashes and package/browser inventory remain unchanged.

Control's redirect reaches `forbidden-sink:3001/target`, with sink hits1. Acceptance uses a distinct internal isolated network without that sink; its redirect fails `ERR_NAME_NOT_RESOLVED`. Successful local form navigation precedes the failure. TestNet and both tested host-listener routes are unreachable. The coordinator records the host listener's positive control. This supports the fixed topology's network criterion; it is not a general internet firewall or arbitrary-host test.

Both containers use the pinned image, UID/GID1000, read-only rootfs, cap-drop ALL, no-new-privileges, no privileged mode or published ports, fixed seccomp, 128 PID/2 GiB/2 CPU limits, and only the prescribed writable evidence/cache/tmp mounts. Seven captured browser rows per mode match the fixed regular kernel executable path/device/inode with no collection errors. Observer and outer rows have all five capability sets zero. The only nonzero effective/permitted pair is exact SYS_ADMIN in an inner zygote with distinct namespace and exact 1000→1000 length1 UID/GID maps; renderer effective/permitted sets remain zero. NNP1/Seccomp2 and normal-main/title classification match the accepted criteria. These are actual observations, unlike the synthetic exe proofs of the previous offline review.

The new profile phases execute successfully in both modes: main-close residue is empty before the missing-browser client; known main names are retained. After the intentional nonexistent-executable error, the only residue is a distinct newly observed empty real directory, UID1000/mode0700, recorded explicitly with `reusableState:false`. The temporal evidence now exists; no old failure is reclassified.

## Receipt check evidence mapping

Paths below are relative to the acceptance8 archive unless stated otherwise. Digests identify actual retained evidence files, not boolean assertions. Supporting files remain linked through the verified manifest; a controller may also construct a canonical per-check bundle of these file digests.

| Check | Primary digest and supporting evidence |
|---|---|
| `static` | Prior exact-source `docs/reports/evidence/2026-09-13-autonomy/playwright-empty-failed-launch-fix/playwright-static/empty-failed-launch-fix/covering.log`, SHA256 `70e0b1d80c962f88da2b778dfae4a824ad431f992a87d546de7106a442359e86`: retained 10/10, previously reviewed; hash reverified, no rerun. |
| `tools` | `canary/acceptance/evidence/main-protocol.jsonl`, `525d024de8ca15c3f73ed7131b018d67c4fa92aab5b3e466b20dde18ec0555cf`: initialize/tools/list, navigation, click/type/submit, fresh snapshots and close. |
| `screenshot` | `canary/acceptance/evidence/playwright/page-2026-09-14T10-42-06-709Z.png`, `24712bf05e31db9fd466156b5b8267bb7eb8f82cb8fdaa0f0d1800a9cc5d2e1d`; protocol/report binds the output and eviction. |
| `readonly` | Acceptance raw report digest below for EROFS/path refusals; `canary/acceptance/readonly-source-policy.json`, `440cb6c31d1d154a7e79c68b4915fd5ffe9e0105c0ed17aaea45b07a9bbed4da`, and container mounts support unchanged read-only inputs. |
| `no_download` | `canary/acceptance/evidence/missing-protocol.jsonl`, `92f2745e23991dd8ffabc3ae26156f6078d9cc9df16c3d4c33a283d712ae217f`: exact nonexistent executable refusal. Equal inventory before/after and isolated topology support no installation/download fallback. |
| `network` | Acceptance raw report plus control raw report `canary/control/evidence/canary-report.json`, `b016a165a0fbe84a863de20553eed01d18a3cf5c14b1eeba5ee744293987d84c`; `canary/acceptance/network-inspect.json`, `c474af176ad119c2668c030a920a61d87802c999899b2f86802ba70363ca9457`, and exact commands distinguish the two topologies. |
| `sandbox` | `canary/acceptance/evidence/browser-processes.json`, `48ff862048322b09c7c44a165bb75f8ba51706a3c719ad3a7d95cc9424eca1a0`, plus `canary/acceptance/container-inspect.json`, `20d66e3c599845afb741a17d0a107deb8c4992deff270a092b7a92e0b8a0262c`. |
| `environment` | `canary/acceptance/evidence/canary-report.json`, `6b6dde45c68d9c45d01e3099b340428cd92c27b6205f1a4da9ec9ac105d0606b`: exact seven-variable environment through the actual env-prefix control; poison preload absent. |
| `stdio_signal` | Same acceptance raw report digest plus real main protocol and empty stderr: env-prefix stdin echo and SIGTERM handler exit23; actual MCP shutdown records exit0 after stdin close/SIGTERM. Limits below. |
| `cleanup` | `canary/commands.json`, `db426fcc772074ae667892c93bb831965e0d1174b2a2a7471bd63e05c0c2e3fd`, raw command outputs, both exit files and both report phase observations. Limits below. |

Artifact values consistently recorded before and after both runs: `browser` = `f5d89353cc9ef8dc1541268bbee1f05ee40a31ce3d9799b3a274e5147f6a8cdb`; `env_executable` = `67a8c7fac47281a5ee335366bcd12f31aa7eeca008cef6eccad38304753ddee9`; `browsers_json` = `f1336b4be3fb71a7b9f2c7acf1bd37a43c154434ea719919a2805507094e4bbf`; `packages_tree` = `3991eee46a4635cd0050cb6b0950abb4965b6235f978c032fb5a21ea8ad92007`; `browsers_tree` = `4833fe0d8aad38164e5cd6fe10b77bae1fe96074a26c60ba5ac4a7a76befb15a`.

## Precise limits

`stdio_signal` establishes the fixed env-launch prefix's actual stdin/stdout and SIGTERM behavior, real MCP protocol transport, and successful shutdown with recorded exit0. The harness closes stdin and sends SIGTERM together; it does not isolate which caused the real MCP exit, test SIGINT, or prove future native-wrapper/Multica signal propagation. Those are separate native integration concerns, not missing evidence for this bounded fixture criterion.

Cleanup commands16–20 remove control web/runner/sink and network; commands31–34 remove acceptance web/runner and network. Every removal exits0 with the exact name in raw stdout. Both runner exit snapshots show exited, PID0, Running=false, ExitCode0; pre-network-removal inspections show `Containers:{}`. No post-removal absence probe is retained. This satisfies the existing targeted cleanup criterion without asserting a stronger independent final-absence audit. If that stronger claim is needed later, the smallest additional verification is a read-only inspect of these exact removed names/IDs, not another browser run; none was required or performed here.

This PASS is limited to the fixed fixture browser runtime/image/vector/source combination. Permanent native adapters, real managed context/MCP integration with models, provisioning/source freshness, credential-selection lifetimes, trusted collector/gate integration, actor authority and whole-loop product acceptance remain separate. No receipt was created by the reviewer, and no historical failure was erased.
