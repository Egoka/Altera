# Task 5 Codex managed-TOML mapping brief

Prepared read-only on 2026-09-14. This is the implementation contract for the trusted mapping step after D2. It does not assume D2 succeeds, prove that the task home exists, read a real `config.toml` or `auth.json`, run Codex/MCP/model/native checks, or authorize an agent/profile/config mutation.

## Goal

Given an accepted D2 descriptor containing one syntactically safe per-task `CODEX_HOME`, open exactly that task home's `config.toml` through a trusted descriptor-relative filesystem walk, extract the one daemon-managed MCP marker block, recognize only Context7, Playwright, and trace, and build:

1. a bounded redacted catalog;
2. a deterministic secret-free container `codex-config.toml`; and
3. the existing runtime `path_map` entries needed for known local executables.

The mapper never copies the daemon TOML, hashes its raw bytes, falls back to a host/global Codex home, installs a package, or launches an executable.

## Inputs and provenance

- D2 contract: `task-5-codex-path-probe-brief.md`.
- Bridge contract: `task-5-codex-bridge-preflight.md`.
- Runtime boundary: `docs/development/runtime-isolation.md`.
- Pinned Multica renderer: [`server/pkg/agent/codex.go` at `2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c`](https://github.com/multica-ai/multica/blob/2ae2dbbb8f9ed9ffe1739ecf5abfe31a940ee50c/server/pkg/agent/codex.go#L511-L865).
- Existing D1 descriptor proof: reviewer Context7 public `/mcp` plus trace `serve`, without headers/env/unknown fields. It is schema/catalog evidence, not authority to reuse yesterday's path.
- Accepted agent snapshot: the Codex tester's saved workspace roster is Context7 plus Playwright. D1 separately proved that native runtime state can add inherited trace beyond that saved roster. Neither fact establishes what the tester's current per-task TOML contains; the mapper must wait for the actual marker block and must not invent or remove trace.

The implementation accepts only a freshly accepted D2 record with the pinned D2 source/build/binary identity, `read_status: "lexical_candidate"`, `canonical_identity: "not_checked"`, the exact expected native cwd, and one lexical `CODEX_HOME` candidate. Historical path records and a successful D2 synthetic suite are not execution authority.

## Exact implementation files

Create only:

- `scripts/agent-runtime/codex_toml_map.py` — isolated Python 3.9 standard-library mapper, strict marker/subset parser, descriptor validation, catalog serializer, and deterministic policy materializer.
- `scripts/agent-runtime/test_codex_toml_map.py` — synthetic filesystem, parser, redaction, roster, materialization, and race tests.

After focused review, update only the Codex mapping section of:

- `docs/development/runtime-isolation.md`.

No Dockerfile, package manifest, lockfile, D0/D1/D2 source, protocol guard, provider proxy, auth path, runtime scheduler, or product source change belongs in this milestone. The existing launcher already consumes a coordinator-built `policy/codex-config.toml`, policy hash, `path_map`, and `managed_mapping_verified`; this mapper prepares those trusted inputs before `runtime.py` is invoked.

## Parser choice

Use `/usr/bin/python3 -I`, currently Python 3.9.6, and only its standard library. Python 3.9 has no `tomllib`. The lockfile's `toml@3.0.0` is a transitive Netlify dependency, is not declared for this tool, and is not import-resolvable in the isolated execution worktree. It must not become an accidental runtime dependency, and no package install is permitted.

Implement a small strict reader for the deterministic subset emitted by the pinned Multica renderer; do not implement or claim a general TOML parser. The accepted subset is:

- UTF-8 without BOM, NUL, CR, invalid code points, or non-canonical line endings;
- the two exact marker lines at column zero, once each and in order;
- zero or more exact `[mcp_servers.<bare-name>]` tables;
- one assignment per line using a bare key, ` = `, and an inline JSON-derived TOML value;
- basic quoted strings with only the escapes emitted by `codexTOMLBasicString`;
- booleans, finite decimal numbers, arrays, and inline tables;
- no multiline/literal strings, dotted keys, array tables, dates/times, comments within the managed block, duplicate table/key, or duplicate marker.

Use the Task 5 trusted-input bounds consistently: at most 64 KiB for the whole config and managed block, nesting depth 16, any decoded string 16 KiB, exactly the three catalog server names at most once, and an 8 KiB maximum catalog JSON. Exceeding a bound produces a fixed failure enum without offending bytes.

The parser must consume each recognized value completely even when the field will later be rejected. For secret-bearing or unknown keys it records only presence and count, discards the value immediately, and never includes its key or value in an exception.

Before recognizing a marker, run a separate bounded lexical guard over the whole file. It is intentionally narrower than TOML:

- reject every triple-basic or triple-literal delimiter (`"""` or `'''`) anywhere in the file;
- scan each physical line while honoring single-line basic/literal strings, basic-string escapes, and `#` comments;
- require quotes, arrays, and inline-table braces opened on a line to close on that same line;
- require both marker lines to occur in normal state at column zero, outside a string/comment value and with zero bracket/brace depth; and
- require the end marker plus its canonical newline to be the final nonblank content in the file, matching the pinned renderer's append-at-EOF behavior.

Any multiline string, multiline array/inline table, dangling escape/quote/bracket, or marker reached in ambiguous lexical state returns `managed_block_ambiguous`. This conservative guard may refuse otherwise valid inherited TOML, which is safe: none of that inherited content is needed or copied. Once it proves the exact final suffix is lexically unambiguous, only the suffix is passed to the renderer-subset parser.

## Exact managed markers and state

The pinned Multica literals are:

```text
# BEGIN multica-managed mcp_servers (do not edit; regenerated by daemon)
# END multica-managed mcp_servers
```

The state machine is:

| Observed state | Meaning | Mapping result |
|---|---|---|
| Exact final-suffix marker pair, no tables | Explicit managed-empty set | Valid strict empty state; materialize marker-only policy. Do not inherit or add servers. |
| Exact final-suffix marker pair, accepted tables | Explicit managed set | Validate every table and map only exact accepted entries. |
| No marker pair | Managed value is absent/null or file is not the expected generated state | `managed_config_absent`; fail closed. Never parse/inherit other `mcp_servers` tables. |
| Partial, duplicate, nested, reordered, non-suffix, lexically ambiguous, or malformed markers | Ambiguous/corrupt state | `managed_block_invalid` or `managed_block_ambiguous`; fail closed. |

Text outside the exact block is lexically guarded only to prove that the marker is a real final top-level suffix; it is neither semantically parsed nor copied. Inherited user/global MCP tables outside the marker cannot enter the container. This preserves Multica's three-state semantics while deliberately refusing the null/absent fallback at the container bridge.

## Descriptor-relative exact-file validation

Do not concatenate the D2 string and call `open()`. The mapper:

1. Opens `/` with `O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW`.
2. Walks every absolute-path component from `/` through the pinned workspace root and then each D2-proven task-home component with `openat`/Python `dir_fd`, `O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW`, retaining every directory descriptor and its initial `fstat`.
3. Requires system ancestors to be directories reached without symlinks. The UID 501 and no-group/world-write rules begin only at the pinned private workspace boundary and apply to its task-home descendants; root-owned system ancestors are not incorrectly required to have UID 501.
4. Opens only `config.toml` relative to the retained verified task-home descriptor using `O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK`. `O_NONBLOCK` must be present before the first `fstat` so a substituted FIFO/device cannot block the mapper.
5. Before reading, requires a regular file, UID 501, mode exactly `0600`, link count one, and size within 64 KiB.
6. Reads through that descriptor only. Its post-read `fstat` must match the initial device, inode, type, mode, owner, link count, size, nanosecond mtime, and nanosecond ctime.
7. While all parent descriptors remain open, reopens each child directory from its retained parent descriptor and reopens `config.toml` from the retained task-home descriptor with the same no-follow/nonblocking flags. Each reopened object must match the retained object's device/inode/type and security metadata; every retained directory's own post-read `fstat`, including ctime, must also match. This proves the names still resolve through the same held chain at the end of the observation.
8. Revalidates the D2 expected cwd/source preservation separately. It never opens `auth.json`, enumerates the directory, follows a host-home fallback, or emits the discovered raw path.

The catalog may record fixed booleans for these checks and a coordinator-assigned task-home identity. It must not record raw path components, inode/device numbers, TOML bytes, or a raw-config digest.

These checks establish one bounded snapshot against symlink, special-file, replacement, and directory-entry races. They do not create a security boundary against another process running as the same UID 501 after the final check. The generated private policy must use the already parsed semantic descriptors and must never reopen the host TOML during model execution. Protecting against an actively hostile same-UID daemon/process requires a different OS identity or stronger isolation and is outside this mapper.

## Fixed redacted catalog

Write canonical JSON with sorted keys and exactly three server rows in this order: `context7`, `playwright`, `trace`. Each row contains fixed enums/booleans only:

```json
{
  "schema": "ALTERA_CODEX_MCP_MAP_V1",
  "managed_state": "explicit_empty|explicit_nonempty|unresolved",
  "descriptor_valid": true,
  "unknown_servers_present": false,
  "unknown_fields_present": false,
  "secret_fields_present": false,
  "servers": [
    {"name":"context7","present":false,"shape":"absent","mapping_ready":false},
    {"name":"playwright","present":false,"shape":"absent","mapping_ready":false},
    {"name":"trace","present":false,"shape":"absent","mapping_ready":false}
  ],
  "managed_mapping_verified": false
}
```

For a present server, replace only `shape` with an allowlisted enum and set `mapping_ready` truthfully. Never emit a raw command, path, URL variant, header/env name or value, unknown server/key name, or TOML fragment. Unknown and secret-bearing data are represented only by booleans/counts. Errors use fixed enums.

Hash only this canonical redacted catalog plus the reviewed mapping-policy version to create the normalized non-secret mapping digest. The raw daemon TOML and any individual secret-bearing field are never hashed. The normal policy hash remains the hash of the generated secret-free container policy.

## Exact server mappings

### Context7

The pinned Multica renderer removes remote `type`, renames JSON `headers` to `http_headers`, and adds `experimental_use_rmcp_client = true`. Accept exactly:

```toml
[mcp_servers.context7]
experimental_use_rmcp_client = true
url = "https://mcp.context7.com/mcp"
```

No `http_headers`, `headers`, `env`, OAuth endpoint, query, fragment, userinfo, alternate port/case/host/path, or other key is accepted, including an empty table. Catalog shape: `context7_public_mcp`. No `path_map` entry is created.

### Trace

Accept either already-cataloged absolute native command identity under the separately reviewed `/Users/egorbondarenko/.trace/bin/` location, with exactly:

```text
args = ["serve"]
```

Both native names `trace` and `trace-mcp` map to the existing container executable `/usr/local/bin/trace-mcp`; the emitted container argv stays exactly `["serve"]`. Bare command/PATH lookup, another native root, review-preset substitution, omitted/extra args, `env`, and any other field fail. Catalog shape: `trace_serve`. The raw native command is matched in memory and replaced by the fixed mapping enum.

The earlier standalone `["serve","--preset","review"]` policy remains valid for its existing caller, but it is not a match for the D1-observed native `serve` entry and is not substituted here.

### Playwright

The D1 public catalog can recognize native `npx` forms and these argv families:

- `["-y","@playwright/mcp"]`;
- `["-y","@playwright/mcp@latest"]`;
- either of the above followed by `"--headless"`.

None is currently safe to execute in the accepted container. The immutable image does not install Playwright MCP, and these forms select an unversioned or `latest` package through a dynamic package runner. This milestone may classify a matching table as `playwright_dynamic_npx`, but must set `mapping_ready: false`, create no `path_map`, and stop before model launch.

Closing Playwright requires a separately pinned, already-present image or reviewed RO policy artifact with an exact static executable, dependency closure, browser binary, argv, version, and no-download proof. Do not translate `npx` to a guessed path, run it for discovery, allow registry access, or install a dependency from this mapper. An optional `type = "stdio"` emitted from managed JSON is not accepted until the pinned Codex config parser and the future static Playwright artifact prove that exact field.

## Materialization

The mapper takes a coordinator-owned, reviewed, secret-free base Codex policy with an expected digest. It rejects any existing `mcp_servers` table or managed marker in that base. It then appends a deterministic block produced from semantic descriptors, never from raw daemon lines:

- exact accepted Context7 table;
- exact mapped trace command/args table;
- future Playwright table only after its separate static-artifact ruling;
- or the marker-only block for explicit managed-empty.

Write the output as a new mode-`0600` file in the private policy generation using exclusive creation, fsync, descriptor revalidation, and atomic publication. Bind its policy hash, redacted catalog digest, D2 identity, Multica commit, source/dirty fingerprint, image ID, model/effort/tier, and intended roster in the trusted run record.

`managed_mapping_verified` is true only when descriptor validation, marker parsing, every present table, every expected-presence rule, and every required executable mapping are ready. An explicit-empty set may be structurally verified as strict empty, but a run requiring MCP tools still fails its separately declared roster check.

## Roster and AGENTS preservation

The mapper is not a roster editor. The accepted current evidence remains distinct:

- native reviewer evidence: Context7 plus trace;
- saved Codex tester workspace roster: Context7 plus Playwright;
- D1 evidence that native runtime state can include inherited trace beyond a saved workspace roster; and
- the desired Codex tester runtime for code work: Context7, a separately pinned Playwright, and trace, with exact origin determined only from the actual TOML.

The catalog always reports all three fixed rows, including absence. If D2 later discovers a two-server managed block, preserve it exactly and report the missing row; do not merge a trace table found outside the authoritative marker or synthesize one from D1 evidence. Add trace through supported managed configuration only if the actual authoritative block proves it absent and the intended role still requires it. If trace is already inside the actual managed block, preserve and map it without another configuration mutation.

The source snapshot independently preserves the daemon-written task `AGENTS.md` at the same absolute cwd, including bytes, Git-like mode, and digest. The TOML mapper never reads, rewrites, concatenates, or replaces it, and RPC keeps `developerInstructions: null`. A managed-empty or trace-absent mapping still carries the original AGENTS context; because that context requires trace-first exploration, a code-exploration run then stops as unavailable rather than weakening the instruction.

Explicit managed-empty therefore means “no MCP servers and no inherited fallback,” while absent/null means “native inherited fallback exists” and is refused by this bridge. Neither state changes cwd, source snapshot, AGENTS precedence, model, effort, tier, session ID, or resume behavior.

## Focused synthetic tests for the later implementation

Use only private synthetic roots and canary values:

1. exact nonempty markers and exact marker-only state;
2. missing/partial/duplicate/reordered/non-suffix markers, marker text inside multiline strings or multiline arrays, and inherited tables outside the block;
3. wrong UTF-8, BOM/CR/NUL, triple-quote delimiter, cross-line lexical state, malformed escape/value, duplicate table/key, forbidden TOML syntax, oversize/depth/string;
4. Context7 exact table and every endpoint/header/env/unknown-field variant;
5. both accepted trace host-name identities with `["serve"]`, fixed Linux mapping, and all path/argv/env variants;
6. all four cataloged Playwright npx forms classified but blocked, with no spawn/network/install;
7. fixed three-row catalog order, absent rows, presence-only unknown/secret summaries, canary non-disclosure, and no raw-config hash;
8. descriptor walk rejection for symlink, race, owner/mode/link/size changes, path escape, file replacement during read, and `auth.json` non-access;
9. deterministic materialization, exact `0600`, fsync/atomic publication, base-policy digest mismatch, and no inherited tables;
10. explicit-empty structural success versus role-roster failure;
11. AGENTS snapshot identity and `developerInstructions: null` remain unchanged in the prepared manifest.

The synthetic suite does not read the real D2 path or prove native acceptance. Preserve the global two-consecutive-failure history; a renamed mapping attempt does not reset a stopped check.

## Dispatch and acceptance boundary

This mapping implementation can be dispatched after D2 source/report review. A real mapping attempt requires D2 to return an accepted current path and a separately authorized descriptor-relative read of exactly that `config.toml`. If D2 fails or the file/path validation fails, record the fixed blocker and stop.

Even with a valid real catalog, Codex model acceptance remains blocked until:

- the intended role's exact managed roster is present;
- Playwright has a pinned static artifact or is explicitly absent from that role's approved roster;
- the generated policy and source/AGENTS snapshot are independently reviewed; and
- the later native canary proves the actual tools and context.

This milestone adds no scheduler, retry loop, profile mutation, auth handling, or fallback.

## Root-review resolution summary

1. D2 input now requires `read_status: "lexical_candidate"`; it does not claim path or filesystem acceptance.
2. The final file is opened with `O_NONBLOCK` before `fstat`, preventing FIFO substitution from blocking.
3. The descriptor chain begins at `/` and covers every ancestor without following symlinks; UID 501 applies only from the pinned private workspace boundary.
4. File and directory checks include ctime and a post-read rewalk/reopen through retained descriptors; the remaining same-UID trust limit is explicit.
5. Saved tester roster and actual runtime TOML are no longer conflated. Trace is added only if the actual authoritative block later proves it absent.
6. Marker authority uses a bounded line-state guard plus an exact append-at-EOF suffix rule. Ambiguous multiline TOML is rejected without implementing a general TOML parser.
