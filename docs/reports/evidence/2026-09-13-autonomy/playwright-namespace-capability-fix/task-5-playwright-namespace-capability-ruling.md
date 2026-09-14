# Namespace-aware Chromium capability check

Ruling: cap-drop ALL is required in the outer runtime user namespace. The old
assertion that every Chromium process must have zero CapEff regardless of its
user namespace conflates the outer grant with Chromium's internal sandbox setup.
The implementation must gather and retain actual process/namespace evidence
before asserting; a capability value alone never proves a permitted inner case.

Primary rationale: Chromium's SandboxLinux::EngageNamespaceSandboxInternal moves
to a new user namespace before reducing capabilities; for zygote it retains only
SYS_ADMIN to create child PID namespaces. This explains a possible legitimate
case, but does not identify the process that failed canary5. Source:
https://chromium.googlesource.com/chromium/src/+/0b7f48c4c5b7dff843b70f17c41dd595d3d74321/sandbox/policy/linux/sandbox_linux.cc
(lines563-580; reference source, not claimed exact installed build source).

Required proof: observer UID/GID1000 and all capsets including bounding zero;
outer rows remain zero. A nonzero effective/permitted set is permitted only for
an exact zygote with exactly0x200000, inheritable/ambient0, a proven distinct user
namespace and exact single UID/GID map rows1000 1000 1 relative to the observer.
No maps to outer0, ranges, missing/ambiguous maps, role substitution or extra bit
may pass. Renderers retain zero effective/permitted sets. NNP1, Seccomp2,
fixed executable path and original no--no-sandbox condition stay mandatory.

Inner bounding sets are recorded, not confused with an effective grant; capset
does not itself remove bounding sets. Namespace readlink EACCES is evidence, not
permission to skip isolation proof. Different readable maps may independently
prove a different namespace; matching or unreadable maps cannot. Record process
identity/race checks and diagnostic rows on failure. Do not add blanket rejection
of legitimate internal --no-zygote-sandbox arguments; that is distinct from the
original browser --no-sandbox prohibition.

Cost if wrong: the next fixed-image run refuses and preserves its evidence.
No capability is added, sandbox disabled, image/vector changed or acceptance
issued. This is a correction to observation of the existing controls within the
approved two-file test scope, not a new runtime permission.
