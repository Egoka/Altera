# Kernel executable identity and Chromium process titles

Canary6 retained the actual cause: the main process has ordinary NUL-separated
argv, but children rewrite cmdline into one reported title beginning with the
fixed image path and role. One renderer title is visibly truncated. Thus exact
argv[0] equality is not a correct executable-identity test for those rows.

Ruling: use readable /proc/PID/exe plus file dev/ino matched to the fixed pinned
image binary, with before/after consistency checks. Keep the exact raw cmdline;
classify ordinary argv separately from a rewritten title. A title may identify
only an anchored known role after the exact binary prefix, with one role token.
It is incomplete reported text, not a reconstructed original command line.
Reject mismatched/unreadable kernel executable identity, wrong prefix, ambiguous
roles and any observed --no-sandbox token. Require the normal main-browser argv
with no --no-sandbox; keep all established child namespace/capability/NNP/seccomp
proof requirements. Do not add a shell parser or new privilege fallback.

Cost if wrong: the last approved canary rejects with retained per-process error;
no new permission or positive acceptance is inferred. No image/vector/runtime/
seccomp changes are allowed. One package invocation remains after scoped PASS.
