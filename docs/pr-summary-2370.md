## Summary

Ran `./scripts/parity-gate.sh` end-to-end against the pinned `neat-core` rev
`36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959` and captured the full output under
`docs/evidence/parity-gate-2370.log`. All three steps pass. No bump to the
pinned rev is required — justification recorded below and on the issue. Closes
#2370.

## Decision: no bump required

- `#2367` (neat-core parity audit) — zero gaps; no upstream issues filed.
- `#2368` (rust_scorer parity audit) — zero gaps; any remaining work is on
  NEAT-AI-scorer, not NEAT-AI-core.
- `#2369` (wasm_activation audit) — two files (`topological_backprop.rs`,
  `topology_ops.rs`) still contain logic not yet in `neat-core` at the pinned
  rev; tracked upstream by `NEAT-AI-core#8` and `NEAT-AI-core#9`. Neither is yet
  landed upstream, so a bump cannot close either gap today.
- Upstream `stSoftwareAU/NEAT-AI-core@Develop` currently resolves to the same
  SHA as the pinned rev (GitHub compare API reports
  `ahead_by: 0, behind_by: 0, status: identical`). There is nothing newer to
  bump to.
- `scripts/rust-ci-cache-key.sh` hashes the git coordinates in `Cargo.toml`
  automatically, so no update was needed there either.

## Evidence

Backend/CLI change — no UI to screenshot. The evidence is the captured
parity-gate log:

- `docs/evidence/parity-gate-2370.log` — complete stdout/stderr from
  `./scripts/parity-gate.sh`, exit 0.

Parity-gate result (tail):

```
[3/3] Deno parity tests (WASM score parity + MSE cost)...
...
ok | 8 passed | 0 failed (37ms)

✅ Parity gate passed (3 step(s)).
```

Step-by-step results:

- `[1/3]` Core dependency policy (`test/scripts/CoreDependencyPolicy.ts`) — 8
  tests ok.
- `[2/3]` Rust tests in `wasm_activation` against pinned `neat-core` — 246 tests
  ok; `RUSTFLAGS=-D warnings` honoured.
- `[3/3]` TypeScript/Deno parity tests (`test/score/WasmJsScoreParity.ts`,
  `test/costs/MSE.ts`) — 8 tests ok.

## Test Plan

- [x] `./scripts/parity-gate.sh` run end-to-end; exit 0.
- [x] Output captured to `docs/evidence/parity-gate-2370.log` and committed.
- [x] Upstream rev comparison via GitHub API confirms pinned rev equals
      `NEAT-AI-core@Develop` (`status: identical`).
- [x] Decision comment posted on #2370.
- [ ] `./quality.sh` — N/A (no source changes beyond captured evidence; no code
      or dependency modifications).
