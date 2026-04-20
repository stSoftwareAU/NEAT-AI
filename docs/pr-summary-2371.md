## Summary

Published the migration verification sign-off comment on #2346 confirming that every in-tree Rust feature has a home upstream (either in NEAT-AI-core or NEAT-AI-scorer) and that the pinned `neat-core` rev `36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959` is sufficient. The sign-off consolidates the three parity audits (#2367, #2368, #2369) and the parity-gate execution (#2370) so the in-tree Rust removal tracked in #2346 may proceed. Closes #2371.

Sign-off comment: https://github.com/stSoftwareAU/NEAT-AI/issues/2346#issuecomment-4279508682

## Evidence

No code changes — this issue is documentation-only. Verification evidence included in the sign-off comment:

- `./scripts/parity-gate.sh` at sign-off SHA `5256ea06f24141b8eb68e877863cd6169eb0e3b5` — ✅ all three steps green (core-dependency policy 8/8, Rust tests in `wasm_activation` 246/246, Deno parity tests 8/8).
- `./quality.sh` at the same SHA — ✅ `ok | 6004 passed (2 steps) | 0 failed | 3 ignored`.
- Captured parity-gate log: `docs/evidence/parity-gate-2370.log`.

Upstream-issue status (all closed or explicitly deferred):

- `stSoftwareAU/NEAT-AI-scorer#9` — closed (MSE-only CLI scope decision).
- `stSoftwareAU/NEAT-AI-core#8` — deferred; lifts `topology_ops.rs` from `wasm_activation/`, not a blocker for `neat-core/` removal.
- `stSoftwareAU/NEAT-AI-core#9` — deferred; lifts `topological_backprop.rs` from `wasm_activation/`, not a blocker for `neat-core/` removal.

## Test Plan

- [x] Re-ran `./scripts/parity-gate.sh < /dev/null` at the sign-off SHA — all three steps passed.
- [x] Re-ran `./quality.sh < /dev/null` at the sign-off SHA — 6004 passed, 0 failed.
- [x] Confirmed upstream NEAT-AI-core `Develop` resolves to the same SHA as the pinned rev (nothing newer to bump to).
- [x] Sign-off comment posted on #2346 linking back to #2367, #2368, #2369, #2370.
