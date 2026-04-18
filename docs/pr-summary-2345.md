## Summary

Add a parity gate that must pass before any in-tree duplicate native Rust is
removed in favour of the external NEAT-AI-core crate. Closes #2345.

- `scripts/parity-gate.sh` — focused three-step gate: core dependency policy,
  `cargo test` in `wasm_activation` against the pinned `neat-core` rev, and
  the Deno parity tests (`WasmJsScoreParity`, `MSE`). Supports `--dry-run`,
  `--skip-rust`, `--skip-deno`, and `--help`.
- `docs/PARITY_GATE.md` — release checklist and runbook (when to run, the
  exact commands, expected artefacts, failure response, sign-off rules).
- `test/scripts/ParityGate.ts` — eight unit tests exercising the CLI (help,
  dry-run plan, skip flags, unknown-option handling) and the runbook
  invariants.
- `scripts/rustlib.sh` — MSRV bumped from 1.82.0 to 1.88.0 because the pinned
  `neat-core` uses `let` expressions in logical conjunctions (stabilised in
  Rust 1.88). Without this, the Rust step of the gate fails to compile on
  fresh machines, defeating the purpose of the gate.
- `AGENTS.md` — references `docs/PARITY_GATE.md` in the docs index and the
  NEAT-AI-core dependency-policy section.

## Evidence

CLI (backend only — no UI to screenshot). Full parity gate run against the
currently pinned `neat-core` rev (`36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959`):

```
[1/3] Core dependency policy check...
ok | 7 passed | 0 failed

[2/3] Rust tests in wasm_activation against pinned neat-core...
test result: ok. 246 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

[3/3] Deno parity tests (WASM score parity + MSE cost)...
ok | 8 passed | 0 failed

✅ Parity gate passed (3 step(s)).
```

Targeted test run for the new and adjacent tests (33 passed, 0 failed):

```
test/scripts/ParityGate.ts                 8 passed
test/scripts/CoreDependencyPolicy.ts       8 passed
test/scripts/RustlibVersionCompare.ts      9 passed
test/score/WasmJsScoreParity.ts            2 passed
test/costs/MSE.ts                          6 passed
```

`./quality.sh --lint-only` and `./quality.sh --check-only` both pass after
the changes.

## Test Plan

- `test/scripts/ParityGate.ts` (new):
  - Script exists and `--help` exits 0 with usage text covering the three
    skip flags.
  - `--dry-run` lists all three steps and reports `Total: 3 step`.
  - `--dry-run --skip-rust` suppresses the Rust step and reports
    `Total: 2 step`.
  - `--dry-run --skip-deno` suppresses both Deno-hosted steps (policy and
    parity) and reports `Total: 1 step`.
  - Unknown option exits 1 with a diagnostic on stderr.
  - `docs/PARITY_GATE.md` exists and covers the required topics
    (`parity-gate.sh`, `CoreDependencyPolicy`, `WasmJsScoreParity`,
    `cargo test`, Release checklist, Failure response).
  - `AGENTS.md` references `docs/PARITY_GATE.md`.
- Existing parity-relevant tests (unchanged, still passing):
  `test/scripts/CoreDependencyPolicy.ts`,
  `test/scripts/RustlibVersionCompare.ts`,
  `test/score/WasmJsScoreParity.ts`, `test/costs/MSE.ts`.
