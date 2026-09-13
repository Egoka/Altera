# Task 5 Codex bridge preflight — documentation correction

> Preparation-only follow-up. This file records the corrected evidence semantics for the Codex bridge; it does not authorize implementation, native execution, model calls, daemon access, or reading `CODEX_HOME` configuration/authentication contents.

## Corrected evidence semantics

1. A metadata-only discovery probe can report only the **lexical candidate path** supplied for the per-task Codex configuration. It must not call that path canonical. Canonical identity is established later by a separate trusted filesystem check that traverses the expected components without following symlinks, validates ownership/type/mode, and binds the opened descriptor to the checked file identity.
2. A trusted run record may contain a digest only for a bounded, redacted, non-secret policy descriptor. It must never hash the raw daemon-created TOML, raw MCP configuration, authentication material, environment/header values, or any other secret-bearing field. Configuration compatibility is recorded through reviewed public descriptor IDs and presence/type booleans, not through a digest of secret-bearing input.

## Correction history

The intended `task-5-codex-bridge-preflight.md` did not exist in either the execution scratch directory or the original checkout scratch directory when this correction was applied, so this focused addendum creates the intended target.

The same two semantic corrections had already been applied to `task-5-native-bridge-brief.md`:

- line 57, under **Milestone B**, says the trusted run record hashes only redacted non-secret policy descriptors and never raw daemon TOML/JSON or secret-bearing fields;
- line 82, under **unresolved inputs**, distinguishes the lexical metadata candidate from canonical identity proven by the later descriptor-relative filesystem check.

Those edits do not change Milestone A lines 22–53 or its D1 probe requirements. They are retained as documentation history while D1 fix1 remains under review.
