# Task 5 pinned Claude refresh schema proof

**Result:** The required schema is recoverable from the pinned immutable artifact. No real credential inspection is needed.

**Image:** `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a` (`altera-agent-runtime:task5`)

**Package:** `@anthropic-ai/claude-code@2.1.263`

**Entrypoint:** `/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`

**Entrypoint SHA-256:** `7d25d7c8ae6c6e009cc7dae4e817f674179fd31fb7761bcd56fee4c2902b4c03`

**Entrypoint size/type:** 215,211,432 bytes; ELF 64-bit (header `7f454c46020101000000000000000000`)

## Inspection boundary

The required trace-first `get_project_map(summary_only=true)` call succeeded for the repository (262 files, 3,132 symbols). The immutable Docker image is outside that repository index, so source navigation used the allowed exact-artifact fallback.

Every artifact command used the exact image digest and:

```text
docker run --rm
  --network none
  --read-only
  --user 65534:65534
  --cap-drop ALL
  --security-opt no-new-privileges
  --pids-limit 64
  --memory 128m
  --env HOME=/nonexistent
  --env XDG_CONFIG_HOME=/nonexistent
  --entrypoint /usr/local/bin/node
  sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a
```

There were no mounts, host HOME, credentials, auth files, Docker socket, ambient host environment values, provider network, login, exchange, model call, or Claude host process. Output was limited to package metadata, hashes, literal offsets, and bounded printable source windows.

The first executable fingerprint attempt read the entire 215 MiB file into a 128 MiB container and exited 137. The unchanged command was not rerun. A streaming hash with a 16-byte positional header read succeeded. This was an inspection-method failure and did not run either stopped acceptance check or affect its counters.

## Proven legacy credential fields

The Linux plaintext store constructs `<Claude config dir>/.credentials.json`, reads it as JSON, and writes it with mode `0600`. The OAuth save path mutates the top-level `claudeAiOauth` object.

| Literal JSON path | Artifact-proven JSON type | Refresh input rule |
|---|---|---|
| `claudeAiOauth.refreshToken` | string | Must be present and non-empty. The CLI also uses `""` as a dead-token tombstone, so an empty string must fail closed. |
| `claudeAiOauth.scopes` | array of strings | Must be present and non-empty for an honest replay of the token's issued scopes. |

The artifact does not support guessed aliases, a top-level `refreshToken`, a string-valued `claudeAiOauth.scopes`, or recursive discovery of similarly named keys.

An adjacent compatibility field exists:

| Literal JSON path | Artifact-proven JSON type | CLI use |
|---|---|---|
| `claudeAiOauth.clientId` | string when present; otherwise absent | Headless login forwards only `CLAUDE_CODE_OAUTH_CLIENT_ID`; if absent, the refresh request uses the CLI's compiled default client ID. |

The approved required inputs remain refresh token and scopes. Before implementing support for credentials whose `clientId` is present and differs from the compiled default, root must choose one of two explicit policies: pass this non-secret field through the fixed child environment, or reject that credential shape as unsupported. Silently dropping a present client ID is not faithful to the pinned CLI behavior.

## Exact parsing and joining semantics

Pinned `auth login` performs these steps:

1. Read `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`.
2. If it is truthy, require a truthy `CLAUDE_CODE_OAUTH_SCOPES`; otherwise exit before the browser flow.
3. Parse the environment scopes with `split(/\s+/).filter(Boolean)`.
4. Pass that string array to the refresh function.
5. Serialize the token request's `scope` field with `array.join(" ")`.

The refresh response has separate semantics:

1. If `response.scope` is not a string, produce `[]`.
2. Otherwise parse it with `split(" ").filter(Boolean)`, using a literal U+0020 space rather than the input parser's whitespace regular expression.
3. Persist that returned string array as `claudeAiOauth.scopes`.
4. Persist `response.refresh_token` when present; otherwise retain the input refresh token.

For the trusted wrapper, the only faithful construction from a stored valid scope array is `scopes.join(" ")`. To avoid a join-then-regex-split changing the array, validation must reject empty elements and elements containing whitespace. It must not trim or normalize individual scope strings.

## Immutable artifact evidence

Offsets are byte offsets in the exact entrypoint SHA-256 above.

- **178,177,942–178,180,542:** plaintext store path function returns `.credentials.json`; its writer JSON-serializes the object and requests mode decimal 384 (`0600`).
- **179,099,700–179,105,900:** refresh implementation constructs `scope:(Array.isArray(t)&&t.length?t:G8).join(" ")`; maps `refresh_token` with fallback to the input token; parses returned `scope` through a function that requires a string and uses `split(" ").filter(Boolean)`; returns `scopes` as that array.
- **179,151,693–179,156,093:** OAuth persistence assigns `refreshToken:t.refreshToken` and `scopes:t.scopes`, then writes the result beneath `claudeAiOauth`. The invalid-grant cleanup path separately writes `refreshToken:""`.
- **192,719,218–192,721,818:** another pinned credential writer serializes a scope array as `scope:e.scopes.join(" ")`, corroborating the array element and joining contract.
- **197,529,800–197,537,800:** `auth login` calls the shared OAuth save routine, which invokes the `claudeAiOauth` persistence function.
- **198,957,043–198,961,443:** headless login reads both required environment variables, parses scopes with `split(/\s+/).filter(Boolean)`, optionally reads `CLAUDE_CODE_OAUTH_CLIENT_ID`, and calls the refresh function. The browser-flow code is in the subsequent branch.

These observations establish the schema and transformation chain without executing it:

```text
.credentials.json
  claudeAiOauth.refreshToken : string
  claudeAiOauth.scopes       : string[]
            |
            v
CLAUDE_CODE_OAUTH_REFRESH_TOKEN : same non-empty string
CLAUDE_CODE_OAUTH_SCOPES        : scopes.join(" ")
            |
            v
CLI split(/\s+/).filter(Boolean)
            |
            v
refresh request scope = array.join(" ")
```

## Pinned implementation bounds

Root has separately fixed these values; the implementation must use them as constants with no environment or manifest override:

- credential file: 64 KiB maximum;
- JSON nesting depth: 16 maximum;
- any JSON string: 16 KiB maximum;
- total child stdout plus stderr capture: 8 KiB maximum;
- exchange timeout: 60 seconds;
- status timeout: 30 seconds;
- model acceptance timeout: 120 seconds.

No model acceptance was run in this proof.

## Implementation consequence

The refresh wrapper can now use an exact, non-recursive adapter:

- require a top-level JSON object;
- require a `claudeAiOauth` object;
- require its own `refreshToken` property to be a non-empty string within the pinned bound;
- require its own `scopes` property to be a non-empty array of bounded, non-empty, whitespace-free strings;
- reject wrong types, missing fields, aliases, inherited/prototype values, or normalization;
- join the accepted scopes with one U+0020 space for `CLAUDE_CODE_OAUTH_SCOPES`.

The only unresolved schema-adjacent decision is treatment of an optional stored `clientId`. The refresh token and scopes schema itself is proven and no longer blocks implementation.

## Acceptance-history preservation

This source proof is neither refresh acceptance nor a rerun. It does not reset, rename, or satisfy the existing two-failure history, and it supplies no basis for retrying either stopped check unchanged.
