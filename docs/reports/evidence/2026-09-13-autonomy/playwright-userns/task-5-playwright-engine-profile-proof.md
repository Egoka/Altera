# Task 5 Playwright — Engine/profile source proof

Date: 2026-09-14  
Status: source preflight plus separately archived root read-only prerequisite
records; no browser/build/MCP check run by this update  
Purpose: bind the reported Engine commit to its vendored seccomp dependency and
record the narrow userns prerequisite result without claiming browser
acceptance.

## Recorded Engine identity

The coordinator's read-only server metadata record reports:

- Docker Desktop `4.73.0 (226246)`;
- Engine `29.4.3`, `linux/arm64`, Git commit `56be731`, built
  `2026-05-06T17:09:05Z`, Go `1.26.2`;
- kernel `6.12.76-linuxkit`;
- Engine module `github.com/moby/moby/v2`, version `v2.0.0+unknown`;
- containerd `2.2.3` at `77c84241...`; runc `1.3.5`.

The original source supplement did not query the daemon, inspect its
configuration, start a container, or run a browser. Root later supplied the
separately archived metadata and bounded `unshare` control records named below.
This documentation update did not rerun them, access configuration, change host
policy, or run Chromium.

## Direct official-source chain

1. Moby's signed [Docker Engine v29.4.3 release][engine-release] identifies tag
   `docker-v29.4.3` and commit `56be731`. Moby's repository documentation says
   Engine release tags use the `docker-` prefix. This directly matches the
   reported server `GitCommit`; it is not a date inference.
2. The official [commit page for `56be731`][engine-commit] shows the change from
   `github.com/moby/profiles/seccomp v0.2.2` to `v0.2.3` in `go.mod` and updates
   the vendored `seccomp/default.json` and `seccomp/default_linux.go` files.
3. The same commit records this `go.sum` module checksum:
   `github.com/moby/profiles/seccomp v0.2.3 h1:nrHNSiECQQvq4WjgceCUgJXIXUJBIswVQ133k4Do2mA=`.
4. The official [moby/profiles `seccomp/v0.2.3` release][profile-release] and its
   [default JSON][profile-json] are therefore the proved upstream module version
   used by this Engine source. The retrieved module-tag JSON was 13,470 bytes and
   had SHA-256
   `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`
   (Git blob SHA-1 `ea5a494afb8d64898fa0f4f47ae0c4f5ba9cbbc9`).
5. Root's later immutable-artifact record retrieved the exact vendored file at
   the Moby commit URL. It was 13,470 bytes, had the same SHA-256 above, and was
   byte-identical to the `v0.2.3` tag file.

[engine-release]: https://github.com/moby/moby/releases/tag/docker-v29.4.3
[engine-commit]: https://github.com/moby/moby/commit/56be731
[profile-release]: https://github.com/moby/profiles/releases/tag/seccomp/v0.2.3
[profile-json]: https://raw.githubusercontent.com/moby/profiles/refs/tags/seccomp/v0.2.3/seccomp/default.json

## Proof boundary

| Claim | Status | Evidence or missing proof |
|---|---|---|
| Reported Engine release is built from Moby `56be731` | **proved** | Reported `GitCommit` exactly matches the signed `docker-v29.4.3` release commit. |
| That Engine source vendors `moby/profiles/seccomp v0.2.3` | **proved** | Exact commit diff, `go.mod`, `go.sum`, and changed vendor paths. |
| The relevant built-in profile source semantics are the `v0.2.3` generation | **proved at source-dependency level** | The Engine commit updates both vendored JSON and Go default-profile source to that module version. This does not establish runtime selection. |
| SHA-256 of `moby/profiles` tag JSON | **proved for the retrieved tag file** | `536529b6...9864c74`, 13,470 bytes. |
| SHA-256 of `vendor/.../seccomp/default.json` at exact Engine commit `56be731` | **proved by later root artifact record** | `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`, 13,470 bytes, byte-identical to the tag file. |
| Profile advertised by the local daemon | **proved by later root metadata record** | `SecurityOptions` contained `name=seccomp,profile=builtin` and `name=cgroupns`; the record says no profile was applied or changed. This is not a per-container effective-options inspection. |
| Candidate is exactly the default plus Microsoft's three-syscall rule | **proved for prepared candidate** | Base SHA-256 `536529b6...9864c74`; candidate SHA-256 `ff9cc602...3b7140`; semantic record says all other rules and fields are unchanged. |
| Saved userns prerequisite probe under built-in seccomp | **proved for the accepted image/control** | UID 1000 `unshare` observation returned child status 1 and `Operation not permitted`. |
| Same saved probe under the candidate | **proved for the accepted image/control** | Same image and UID returned child status 0 with empty stdout/stderr; candidate unchanged, no network/mount/auth, and no host policy change. |
| Chromium succeeds sandboxed with the candidate on this local kernel/LSM/runtime | **not checked** | Requires the implementation canary with the pinned browser and no `--no-sandbox`. |
| Playwright MCP and browser/network acceptance | **not checked** | Requires protocol/tool, origin, no-download, filesystem, and real network-boundary controls. |

The Engine module string `v2.0.0+unknown` does not weaken the direct binding:
the server supplies `GitCommit=56be731`, and the signed release independently
maps Engine `29.4.3` to that same commit. It also does not prove runtime profile
selection.

## Closed prerequisite proof and remaining acceptance

The earlier version required exact vendored bytes, local daemon profile
readback, a one-rule candidate, and a controlled cause proof. Root subsequently
recorded them without a browser, public network, mount, credentials, build, or
host policy change:

1. `task-5-playwright-engine-vendored-seccomp.json` binds the exact Moby
   vendored bytes to SHA-256
   `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`.
2. `task-5-playwright-engine-local-readback.json` records the local daemon's
   advertised `builtin` seccomp option and `cgroupns`, with
   `profile_applied_or_changed: false`.
3. `task-5-playwright-seccomp-candidate-proof.json` binds the prepared
   candidate to SHA-256
   `ff9cc602bfbd54007f4894c121d9f3013e4e7a2a9b9b7a7d3fcd7c2f0f3b7140`
   and records exactly one added allow rule for `clone`, `setns`, and `unshare`,
   with all other fields and rules unchanged.
4. `task-5-playwright-userns-proof.json` records the same accepted image
   `sha256:0baed89d66accc9338e938d6c0a81924014836561890d12005063b0b7bdb409a`
   and UID 1000 for both controls. Built-in seccomp produced child status 1 and
   `unshare: unshare failed: Operation not permitted`; the candidate produced
   child status 0 with empty stdout/stderr. Both outer invocations exited 0 with
   no Docker stderr, and the candidate remained unchanged.

This closes the narrow seccomp/userns prerequisite for the saved control. The
candidate remains `prepared_only`, and the host policy remains unchanged.
Implementation still must validate and bind the exact host file, inspect the
applied tester-container security options, install the pinned browser during the
authorized image build, prove no runtime download, launch Chromium sandboxed
without `--no-sandbox`, complete MCP initialize/tool/browser interaction against
the declared local origin, and prove the actual network and filesystem
boundaries. The control does not prove Chromium's namespace sequence or all
`clone`/`setns`/`unshare` behavior.

## Host-path correction for `--security-opt`

For `docker run --security-opt seccomp=<path>`, `<path>` is resolved on the
coordinator/daemon host before the container starts. It is not a container path.
The coordinator must stage the reviewed JSON at a private absolute host path,
outside all source, cache, evidence, and model-writable mounts. Validate a held
regular-file descriptor (no symlink, expected owner and restrictive mode), bind
its path identity and SHA-256 before invocation, and verify the same identity
and hash after container removal. Do not mount the policy into the model
container. The earlier `/runtime/policy/playwright-seccomp.json` example is
invalid unless that exact string is independently proven to be the host path.

## Preserved result

This resolves the Engine-commit-to-vendored-bytes question, the daemon's
advertised built-in selection, the exact one-rule candidate, and the saved
userns prerequisite control. It deliberately leaves applied container policy,
local Chromium sandbox behavior, Playwright MCP behavior, origin enforcement,
browser availability/no-download, and network containment open. No existing
failure counter or acceptance status changes.
