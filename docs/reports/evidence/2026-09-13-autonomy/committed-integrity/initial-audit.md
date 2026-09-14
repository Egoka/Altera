# Committed evidence integrity audit

Date: 2026-09-14  
Git source: `dc054d234242a833bc5994c2536adfdb583dffbe`  
Verdict: **incomplete** — 38 manifest-promised `.log` blobs are not tracked at
this HEAD. Every present promised blob matches its manifest SHA-256 and declared
byte count; there are no content or size mismatches.

## Method and schema boundary

The audit read manifests and artifacts only through `HEAD:<path>` Git objects.
For every archive entry with a concrete `file`, `path`, `archive`, or `archived`
destination, it required a tracked blob at that exact archive-relative path,
hashed the committed blob bytes with SHA-256, and checked `bytes` when supplied.
Working-tree or scratch presence did not count.

Twelve archive-inventory manifests were tracked and parseable. Their 558 rows
contain 554 promised stored artifacts and four D1 rows explicitly marked
`archive: "metadata_only_binary"`. The audit validated 516 of the 554 promised
stored artifacts; the other 38 are the exact missing paths below.

The following records are intentionally outside the stored-artifact count:

- `task-5-d2/archive-manifest.json` has 13 separate top-level
  `metadata_only` rows for binaries/canaries; they are not in its `files` array
  and do not promise tracked binary blobs.
- `task-5-d1/archive-manifest.json` and
  `task-5-d1-fix1/archive-manifest.json` each contain two
  `metadata_only_binary` rows. Their hashes remain metadata claims.
- The tracked nested `d1-review/manifest.json` and
  `d1-fix1-review/manifest.json` contain 9 `name`/`sha256` source-bundle rows
  each, without an archive destination. They are evidence manifests rather than
  archive inventories; their own committed manifest blobs are hash-validated by
  the enclosing archive manifests.
- `task-5-implementation/archive-manifest.json` separately records three
  `symlink_metadata_only` observations. It does not promise stored symlink or
  referent blobs for those rows. All 223 concrete `files` destinations in that
  manifest are tracked and hash-valid.

## Validated counts

| Archive inventory | Stored valid | Stored promised | Result |
|---|---:|---:|---|
| `claude-refresh-implementation/archive-manifest.json` | 47 | 47 | valid, including all 27 listed `.log` files |
| `claude-refresh-fix1/archive-manifest.json` | 19 | 19 | valid, including all 12 listed `.log` files |
| `playwright-userns/archive-manifest.json` | 11 | 11 | valid |
| `d2-native/archive-manifest.json` | 8 | 8 | valid |
| `task-5-d2/archive-manifest.json` | 69 | 79 | 10 missing |
| `d1-native/manifest.json` | 5 | 5 | valid |
| `task-5-d1/archive-manifest.json` | 44 | 44 | valid; 2 metadata-only binaries excluded |
| `task-5-d1-fix1/archive-manifest.json` | 30 | 30 | valid; 2 metadata-only binaries excluded |
| `task-5-mcp-policy/archive-manifest.json` | 42 | 65 | 23 missing |
| `task-5-codex-protocol/manifest.json` | 6 | 11 | 5 missing |
| `task-5-implementation/archive-manifest.json` | 223 | 223 | valid; 3 symlink metadata rows excluded |
| `task-5-fix1/archive-manifest.json` | 12 | 12 | valid |
| **Total** | **516** | **554** | **38 missing; 0 hash/size mismatches** |

The refresh correction at `dc054d2` is effective: all 39 exact `.log` paths
listed by the two refresh manifests are tracked and match both hash and size.

## Exact missing tracked artifacts

### `task-5-d2` — 10

- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/d2-cause-verification/stderr.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/d2-cause-verification/stdout.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-covering-2.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-covering.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-format.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-green.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-local-proof.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-pin-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-recovery.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-d2/task-5-codex-path-probe-red.log`

### `task-5-mcp-policy` — 23

- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-1/run/evidence/trace-index.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-1/run/evidence/trace-stderr.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-1/stderr.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-1/stdout.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-2/run/evidence/trace-index.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-2/run/evidence/trace-stderr.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-2/stderr.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/mcp-policy-canary-2/stdout.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-canary-covering.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-canary-final.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-canary-green.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-canary-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-doc-format.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-format.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-proxy-final.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-proxy-green.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-proxy-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-python-green.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-python-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-real-1.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-real-2.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-trace-shape-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-mcp-policy/task-5-mcp-policy-commit.log`

### `task-5-codex-protocol` — 5

- `docs/reports/evidence/2026-09-13-autonomy/task-5-codex-protocol/task-5-codex-protocol-python-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-codex-protocol/task-5-codex-protocol-js-red.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-codex-protocol/task-5-codex-protocol-python-green.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-codex-protocol/task-5-codex-protocol-js-green.log`
- `docs/reports/evidence/2026-09-13-autonomy/task-5-codex-protocol/task-5-codex-protocol-commit.log`

This is only committed-archive integrity evidence. It does not validate source,
rerun a test, or change any acceptance/failure counter.
