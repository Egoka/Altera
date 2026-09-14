# Current action metadata preservation

Ruling: the explicit fresh snapshot must be the only source for reference lookup
and final page marker. Preserve the successful result of the same current action
separately; final URL may be established by that action result or its immediately
requested fresh snapshot. Never retain a previous page/action for fallback and
never merge stale action element refs into the fresh snapshot.

Reason: actual saved action responses carry Page URL metadata, while the new
explicit browser_snapshot metadata shape is unobserved. Requiring the latter to
repeat URL silently strengthens the previous contract and discards valid current
evidence. This is a delta-specific robustness finding, not another observed live
browser failure. No browser run is authorized by this ruling.

Minimal correction is limited to the existing two canary/test files. Test an
empty successful action plus fresh snapshot; URL-bearing current action plus a
fresh tree-only snapshot; fresh refs differing from action refs; and failed
action/snapshot paths. Old evidence and focused RED/GREEN must be retained.
No security/vector/image/runtime/package change or acceptance weakening.
