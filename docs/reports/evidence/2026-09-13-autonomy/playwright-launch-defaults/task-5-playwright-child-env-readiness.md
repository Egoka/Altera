# Playwright child environment readiness — bounded interface preflight

Date: 2026-09-14. Read-only preflight; no implementation or acceptance.

## Finding

The accepted launcher prevents ordinary host environment passthrough into Docker. It does **not itself establish** that the effective Playwright MCP environment has exactly seven names, or prove absence of all `SELENIUM_REMOTE_URL`, `PLAYWRIGHT_MCP_*`, `PWDEBUG`, and `NODE_OPTIONS` values at the eventual Node entrypoint. The remaining uncertainty is image-derived environment plus the pinned Codex MCP subprocess implementation. No harmful variable was observed: no actual host/container environment was read.

A TOML `env` table must be treated as fixed assignments, not evidence of complete environment replacement. Do not label this a demonstrated exploit or assert that Codex inherits every variable; its precise pinned MCP filtering remains unproven.

## Immutable source evidence

Trace `get_outline` first targeted the exact runtime and guard execution-worktree paths; both returned `SECURITY_VIOLATION`. Root expressly permitted the immutable fallback. Inspected commit `123d1e6f9c6c5199c8a4fe6bf16b451bfe11a084` using `git show`; no mutable mapper source was used.

- `runtime.py`, SHA256 `053369e7724fe894fe0c882b2467ebd19d8634a3e7604ba06d4d9ffd9c5aed86`: `child_env` lines23–26 supplies only literal PATH, empty HOME, and Docker socket address to the **host Docker client**. `execute` lines506–508 uses that mapping explicitly. This mapping is not the container environment.
- `command` lines437–461 mounts trusted Codex config and provides literal container HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, TMPDIR, TMP, TEMP, XDG_CACHE_HOME and TRACE_MCP_TELEMETRY. It has no `--env NAME` value lookup, env-file or general host passthrough. The incoming host environment is consulted for managed path equality, not copied to container env.
- `launch` lines518–530 adds only fixed proxy literals when selected: HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, empty NO_PROXY, NODE_USE_ENV_PROXY=1. Docker image defaults/generated environment are not removed or validated by this code.
- `protocol-guard.mjs`, SHA256 `dbf3e9399c12e29fe71cc1cf2057e06f79694a9b77c60d94eabbafd644183fc2`: `main` lines64–67 spawns the fixed CLI without an `env` option, so Node passes the guard environment to Codex. Its protocol config allowlist lines35–47 is not a child-process environment filter; preserve it unchanged.

Narrow source spans are saved in `task-5-playwright-child-env-source-proof.json`, SHA256 `38ca6791c52c00d490e2c917d22256ef2171a7150a7316e629694cad45f0cf8d`. This is static source evidence, not a launch test.

## Codex evidence and limit

Root identifies image `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a` as containing `@openai/codex@0.154.0-alpha.6.2`; no exact Rust source artifact for that build is known. Metadata-only checks of `/usr/local/bin/codex` and the two explicit conventional public package.json locations under `/usr/local/lib/node_modules` and Node24.12.0's nvm prefix found no package. No private state/cache scan, binary execution or container operation followed. This does not imply absence from the image or other installation locations.

Current [OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) describes `env` as server assignments and `env_vars` as variables allowed and forwarded. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) calls `env_vars` additional whitelisted variables. Neither opened page establishes the default inherited name list or a replacement guarantee for this exact prerelease. In particular, `env_vars=[]` is not proof of an empty base environment. No current GitHub source was substituted for pinned binary behavior.

## Smallest contract correction

Change “exactly seven effective names” to: the seven required names have exact trusted values; all other effective names must be explicitly named and justified, and the four hazardous classes above must be absent. Additional harmless names alone are not a failure. No pinned Codex-specific mandatory extra has been established by this preflight.

Concrete safe candidates already sourced from accepted runtime literals are `TMP=/runtime/tmp`, `TEMP=/runtime/tmp`, and `XDG_CACHE_HOME=/runtime/cache/xdg`: these direct temporary/cache writes into existing private runtime mounts. `TRACE_MCP_TELEMETRY=off` is another known fixed benign value, though unnecessary for Playwright. Root may permit these if observed by the later synthetic child receipt; they do not require a shim merely to reduce the count to seven. This is a proposed explicit allowance, not a claim that Codex currently forwards these names.

Do not blanket-allow arbitrary `CODEX_*`, proxy variables, or image environment. CODEX_HOME/CLAUDE_CONFIG_DIR are not needed by this browser server. HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY/NODE_USE_ENV_PROXY alter networking and need their own role-specific justification; the parent model's fixed provider proxy settings do not automatically belong in a browser whose permitted destination is the isolated application network. Image version labels and Docker-generated HOSTNAME may be harmless, but their exact future image provenance and necessity are unverified here and they are not required additions.

If the next build's image environment proof and pinned no-model MCP child receipt establish the contract above, **no launch shim is needed**. The current source evidence alone cannot make that claim.

If root needs deterministic construction independent of Codex's unproven inheritance, the smallest concrete alternative is a fixed `/usr/bin/env` command with argv `-i`, the seven literal `NAME=value` assignments from the launch ruling (plus only approved fixed extras), `/usr/local/bin/node`, and the unchanged absolute MCP entrypoint and full corrected fixed argv. It uses no shell, interpolation, env passthrough, arbitrary argv, or source-side settings. This is a config-level exec adapter; it avoids inventing custom launcher source. Clearing occurs before Node starts, so NODE_OPTIONS cannot execute a preload before a JavaScript shim sanitizes itself. The seven assignments remain the reviewed values, including the fixed executable path/sandbox arguments from the root ruling.

This alternative requires root approval of the changed fixed command/argv interface, and later image proof for `/usr/bin/env` plus a synthetic receipt showing effective names/values and preserved stdin/stdout, signals and exit status. It is not authorized or implemented here. Dynamic-loader injection into the first trusted executable is still governed by trusted image/environment provenance; an env adapter is not a substitute for that evidence. Do not retain unspecified Codex extras “just in case”; name a demonstrated requirement before extending the contract.

## Next bounded receipt (not executed)

The already planned no-model launch receipt should distinguish incoming MCP-child names from final Node names, report only fixed expected values/presence booleans, and use synthetic poison values for SELENIUM_REMOTE_URL, representative PLAYWRIGHT_MCP_* settings, PWDEBUG and NODE_OPTIONS. A poison preload must not run. Check seven exact values plus approved extras, corrected sandbox and executable argv, protocol transparency, and unchanged network isolation. No browser/image identity or successful browser launch is claimed by this preflight.

No tests, Codex, install, browser, model, auth, API, Multica or native operation ran. No source, index or HEAD was modified. Only this scratch document and its narrow source-proof JSON were written. The mapper remains the sole source writer.
