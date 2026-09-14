# Playwright static launch: root correction before implementation

Date: 2026-09-14. Read task-5-playwright-static-brief.md together with task-5-playwright-launch-defaults-preflight.md (SHA256 b8ecc2e4e2aa01738d16aac209f4703a598f3bb687087b4e7a3c9c4894b7b1ca). This supplement supersedes the older fixed argv paragraph only where explicitly stated. The earlier brief and its evidence remain historical source; no browser acceptance is claimed.

Ruling: use the preflight's corrected exact command: add --sandbox immediately after --headless, followed by --executable-path=/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell. Keep all other fixed args/order, and keep --browser absent. Permit this one coordinator-generated executable argument while refusing arbitrary/native executable overrides. Pinned MCP defaults retain channel=chrome; explicit executablePath overrides binary resolution. Do not claim the channel is cleared or that the former command necessarily disabled sandbox. Its confirmed mismatch was branded Chrome selection against a shell-only install.

The literal path is specific to Linux arm64/bookworm and pinned core descriptor revision1243/version153.0.8010.12. The build must prove its actual platform/descriptor/executable identity; no alternate path or browser is selected at task time. Explicit --sandbox records requested behavior; actual sandbox launch and syscall/network/mount evidence remain mandatory.

Ruling: treat the preflight's seven-name MCP child environment as the required effective environment: PATH, HOME, TMPDIR, PLAYWRIGHT_BROWSERS_PATH, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, PLAYWRIGHT_SKIP_BROWSER_GC, npm_config_offline with exactly its fixed values. Do not assume a TOML env table removes inherited variables. Verify how the accepted Codex runtime constructs the child environment, particularly SELENIUM_REMOTE_URL, PLAYWRIGHT_MCP_*, PWDEBUG and NODE_OPTIONS. If the effective environment cannot be established with the scoped existing runtime policy, raise the concrete interface gap before adding a new launcher/shim; no broad native-env passthrough.

All earlier seccomp, nonroot, capabilities, read-only, isolated network, package/browser pins, no runtime download, tests and two-failure constraints remain. Browser/archive/executable/image hashes are unknown until actual build; source spans are not that evidence. Cost if wrong: the pinned browser may fail to start under the requested sandbox, in which case preserve failure evidence and diagnose; never use --no-sandbox/root/unconfined as recovery.

## Final fixed environment interface ruling

After task-5-playwright-child-env-readiness.md (SHA256 bb695895bcb1f36411d4e0278b6b868fd74fe22e26b37effbd3b6b9155c60ed5), select deterministic environment replacement with the image-owned /usr/bin/env executable. This supersedes the earlier Node command as the MCP command; no custom JS or shell shim is added. The final ordered vector is:

```text
/usr/bin/env
-i
PATH=/usr/local/bin:/usr/bin:/bin
HOME=/runtime/cache/playwright-home
TMPDIR=/runtime/tmp
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_SKIP_BROWSER_GC=1
npm_config_offline=true
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

Do not forward any native env/argv value into this vector. Keep the generated TOML environment absent or empty; the literal assignments construct the final Node environment before Node can process a preload. No optional extras are required for this selected vector. Image provenance still must exclude loader injection into env itself; clearing Node env does not prove that earlier boundary. The planned focused synthetic poison-environment receipt must show preload not executed, exact final names/values, stdio/signal/exit preservation and exact image /usr/bin/env identity. This is part of the existing canary/runtime test scope, with no new launcher file.

Browser-build receipt scope: the original mandatory descriptor, installed executable digest and immutable image identity remain decisive. Record the official archive URL and archive digest if the installer leaves bytes available, but do not add a second download or custom downloader solely to recover a deleted zip. If the installer removes it, archive digest remains explicitly unknown; never invent it or claim independent archive integrity. The npm lock integrities and installed descriptor/executable/image binding remain required. This narrows an additional preflight recommendation, not the original tested-runtime acceptance criteria.
