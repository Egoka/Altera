# Playwright MCP pinned launch-default preflight

Read-only source verification, 2026-09-14. **The static brief needs two fixed argv additions: `--sandbox` and an exact image-owned headless-shell `--executable-path`.** Keep `--browser` absent. This is a source-backed launch contract, not a browser/image/sandbox acceptance result. No package installation, package scripts, build, browser, model, auth, native or Multica operation ran; only official public registry GETs and local archive/source analysis occurred. No repository source/index/HEAD changes.

## Provenance

Private evidence root: `/private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/playwright-launch-preflight/`.

The official registry metadata and tarball bytes matched both exact SHA512 integrities already pinned in the static brief:

| Artifact | Tarball bytes | Tarball SHA256 |
| --- | ---: | --- |
| `@playwright/mcp@0.0.80` | 22863 | `b81eda3f0a7cc70a9caf7db520cdad58c48a1dd334b4e3fcf096c0512c98af0d` |
| `playwright-core@1.63.0-alpha-2026-08-31` | 3118000 | `3d4532e810f39a478ed4924d0189eaf5909d3d02c1ee62bc6c2ff575bdf3d360` |

`registry-provenance.json` records metadata URLs, exact tarball URLs, integrity strings, byte counts and SHA256. The MCP package manifest pins both `playwright` and `playwright-core` to this exact alpha version. Its `cli.js` imports `tools` from coreBundle and calls `tools.decorateMCPCommand`; therefore the relevant MCP defaults are in the pinned core package. The separate `playwright` and browser-helper packages were not downloaded or executed for this named-risk analysis.

`source-hashes.json` records every selected member. Important pins: MCP `cli.js` SHA256 `70dab09ab9a5bc1943fb78e2655f00af7349f9931073833919f19c5d7d786ad6`; coreBundle `7aa0bf8b6b69d32065912e3d8f7e3c18c62de4d668f770a8e039811d3cf9c6a0`; utilsBundle `2d1ccc01d21b7d54ca99a6305991d7fb6e072ea4e725d7fec5eb6184188c52c9`; browsers.json `f1336b4be3fb71a7b9f2c7acf1bd37a43c154434ea719919a2805507094e4bbf`.

`source-spans.json` contains22 narrow source spans, exact member SHA, line/byte offsets and independently hashed raw snippets in `spans/`. Its SHA256 is `06705dc8ef9e336bf6f69a7e982a77b0df450ee9c3305374447210206261c03e`. Archive indexes are retained; no app-source crawl was performed. The official [v0.0.80 README](https://raw.githubusercontent.com/microsoft/playwright-mcp/v0.0.80/README.md) was also read; its positive sandbox option is documented, but the exact defaults below come from the pinned implementation, not an assumption from help text.

## Exact behavior of the pinned code

| Named source span | Finding |
| --- | --- |
| MCP `cli.js:18–32`, coreBundle `73488–73498` | CLI delegates to core; positive `--sandbox` and `--executable-path` are supported options. |
| coreBundle `72641–72645`, `72218–72232`, `72292–72305` | Empty default browser config is merged with explicit config/environment/CLI; missing browserName becomes `chromium`, and missing channel becomes `chrome`. |
| coreBundle `72332–72365` | `--browser=chromium` maps to channel `chrome-for-testing`; it does **not** select a channel-less headless shell. Explicit sandbox maps directly to `launchOptions.chromiumSandbox`. |
| utilsBundle `53829–53843`, `53469–53478` | Because both positive and negative sandbox options exist, omission leaves the CLI value undefined. Positive `--sandbox` supplies true. |
| coreBundle `72299–72303`, `43307–43316` | On Linux, the core fallback is sandbox true for default `chrome`, false for channels `chromium`/`chrome-for-testing`. Browser argv gets `--no-sandbox` unless chromiumSandbox is exactly true. Thus it would be inaccurate to say the original no-browser command necessarily disables sandbox; its immediate mismatch is branded Chrome selection. |
| coreBundle `43339–43344`, `33185–33193` | A channel selects that channel's executable. Only absent channel plus headless selects `chromium-headless-shell`; branded Linux Chrome points at `/opt/google/chrome/chrome`. |
| coreBundle `73326–73338`, `39748–39758`, `39894–39900` | Isolated MCP forwards launchOptions. Explicit executablePath is checked for existence and selected **before** registry/channel executable selection. Validation does not clear `channel=chrome`; the custom executable overrides its binary resolution. A missing explicit path fails rather than choosing another browser. |

Smallest correction retains the current no-`--browser` choice, adds positive sandbox intent, and pins the actual shell path. Adding `--browser=chromium` alone would select the full Chromium artifact and the Linux no-sandbox fallback, contradicting `install chromium --only-shell`. No `--config`, dynamic browser selection or native executable override is needed.

## Corrected fixed command candidate

For the intended **Linux arm64, Debian12/bookworm** build, the pinned browsers.json declares `chromium-headless-shell`, revision `1243`, version `153.0.8010.12`. Registry directory naming converts hyphens to underscores; the Linux arm64 executable tuple is `chrome-headless-shell-linux-arm64/chrome-headless-shell` (coreBundle `32648–32669`, `32793–32800`, `33081–33094`). Therefore the expected installed path is the literal below. It is a source-derived expectation; existence, canonical identity, executable hash and final image remain unverified until build.

```text
/usr/local/bin/node
/opt/playwright-mcp/node_modules/@playwright/mcp/cli.js
--headless
--sandbox
--executable-path=/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell
--isolated
--block-service-workers
--allowed-origins=http://altera-web:3000
--codegen=none
--image-responses=omit
--output-dir=/runtime/evidence/playwright
--output-max-size=16777216
```

The resulting expected config is browserName `chromium`, retained channel `chrome`, headless true, chromiumSandbox true, isolated true and that exact custom executable. Receipts must not claim channel is null/cleared. The binary choice is bound by custom executable precedence. Runtime policy must permit only this internally emitted path, rejecting every native/user-supplied executable path and alternate browser/sandbox switch. If build architecture or installed descriptor differs, stop; do not choose another path during a task run.

Use a freshly constructed MCP child environment, not an overlay retaining arbitrary inherited values:

```text
PATH=/usr/local/bin:/usr/bin:/bin
HOME=/runtime/cache/playwright-home
TMPDIR=/runtime/tmp
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_SKIP_BROWSER_GC=1
npm_config_offline=true
```

PATH and private TMPDIR are the existing runtime base-environment contract; ensure they survive the MCP environment construction. The shell path is independent of PATH. Temporary browser profiles/artifacts use the private writable temp area (coreBundle `39735–39738`), while the image browser tree remains RO. No `PLAYWRIGHT_MCP_*`, `PWDEBUG`, `NODE_OPTIONS`, test overrides, host display, credentials, host browser or remote-connect settings should survive this allowlist. This is consequential: `SELENIUM_REMOTE_URL` diverts core launch before custom executable selection (`39636–39643`); MCP env can provide config/browser/executable/CDP/extension/sandbox/proxy fields (`72444–72485`); debug inspector mode can override headless (`39854–39862`). Explicit executable/sandbox args do not make an inherited arbitrary environment safe.

## Minimal brief correction and later receipts

Root should replace the current argv block with the block above and clarify the prohibition: reject arbitrary/native executable paths, while permitting this single trusted image path. Add the sandbox/default/channel explanation. Keep the existing locked install, `install chromium --only-shell`, image-owned browser, nonroot/cap-drop/no-new-privileges, exact reviewed seccomp, private writable cache/tmp/evidence and enforced network topology unchanged. No security weakening or alternate browser installation is proposed.

The later authorized build/canary receipt must bind:

1. Exact four-package closure/lock/integrities and installed MCP/core manifests/source hashes; actual image platform must be Linux arm64/bookworm for this literal path.
2. Installed browsers.json SHA and selected shell descriptor revision1243/version153.0.8010.12; actual browser download URL/archive digest, final executable path/type/canonical identity/SHA256 and immutable image ID. Browser archive/executable/image hashes are **unknown here**.
3. Exact MCP argv and constructed environment, actual launch config (including retained channel), actual executable in the browser process, and absence of `--no-sandbox`. Explicit `--sandbox` proves requested launch semantics only; kernel sandbox operation still needs the existing real canary and security-option evidence.
4. Existing UID/capabilities/no-new-privileges/seccomp hash, RO mounts, private temp/evidence, no-download controls and network/origin tests. The explicit executable branch bypasses core's registry executable selection and its associated prelaunch host-dependency check, so actual system-library sufficiency must still be established by the build/canary.

No Chromium executable or browser archive was fetched; no CLI, core code, npm scripts or browser were executed. This closes the source-default ambiguity only. It does not accept a Playwright runtime, sandbox, MCP flow, model/native tester or actual image.
