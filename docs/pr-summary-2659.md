# PR Summary — Harden topology ops against memory traps (Issue #2659)

## Summary

Hardens the WASM topology bridge (TypeScript side) so callers and tests can rely
on **defined error codes** instead of an uncatchable WASM
`RuntimeError: memory access out of bounds` when an evolved creature emits a
pathological edge list. Adds forward-compatible TS constants matching the Rust
hardening landed upstream in
[NEAT-AI-core #69](https://github.com/stSoftwareAU/NEAT-AI-core/pull/69), plus a
regression test that feeds intentionally corrupt flat arrays through every
public topology bridge function. Closes #2659.

The TypeScript-side `withWasmTrapGuard` mitigation (NEAT-AI #2650) already
converted WASM traps into typed `TopologyError`s so `evolveRL` could drop bad
offspring. Issue #2659 asked for the **root fix** in the Rust/WASM
implementation. That fix lives in NEAT-AI-core PR #69; this NEAT-AI PR is the
corresponding consumer side:

- New TS constants `TOPOLOGY_MALFORMED_BUFFER = 6` and
  `STRUCTURAL_MALFORMED_BUFFER = 10` mirror the Rust additions so callers can
  match on the new defined codes once `bump-deps.sh` rolls the new
  `wasm_activation` bundle in.
- New `test/wasm/WasmTopologyOpsMalformedBuffers.ts` regression suite feeds
  corrupt flat arrays (length mismatch, OOB indices, `numOutputs > numNeurons`,
  `numInputs > numNeurons`) directly through `validateTopology`,
  `scanAvailableConnections`, `computeReverseTopologicalOrder`,
  `validateStructuralIntegrity`, and `detectCycles`. Every test asserts that the
  call returns a defined typed result **or** a `TopologyError` from the trap
  guard — never an uncaught WASM trap.

## Cross-repo flow

```mermaid
flowchart LR
  ISSUE["NEAT-AI #2659"] -- "root fix" --> CORE["NEAT-AI-core #69"]
  CORE -- "wasm-bundle-&lt;SHA&gt; release" --> BUMP["bump-deps.sh"]
  BUMP -- "deno.json neatCore.rev" --> NEATAI["NEAT-AI (this PR)"]
  NEATAI -- "TOPOLOGY_MALFORMED_BUFFER constants<br/>+ regression tests" --> CONSUMERS["evolveRL consumers"]
```

The regression tests pass today (the trap guard catches every malformed case)
and will keep passing after the bundle bump (the Rust ops return the new
MALFORMED_BUFFER codes as defined typed results instead of trapping).

## Evidence

- **Existing tests still pass**:
  `deno test test/wasm/WasmTopologyOps.ts
  test/wasm/WasmTopologyOpsTrapGuard.ts`
  — 19 passed, 0 failed.
- **New regression suite passes**:
  `deno test
  test/wasm/WasmTopologyOpsMalformedBuffers.ts` — 9 passed, 0
  failed.
- **Upstream Rust hardening verified**: NEAT-AI-core PR #69 adds 13 new Rust
  unit tests for the malformed-buffer paths in `topology_ops.rs` and they pass
  alongside the existing 30 (`cargo test --workspace
  --lib` — 139 passed, 0
  failed). Clippy clean with `-D warnings`.

This is a backend / library change with no UI surface, so a screenshot is not
applicable. Verification is via test results above.

## Test Plan

- Added `test/wasm/WasmTopologyOpsMalformedBuffers.ts` covering:
  - `validateTopology`: length mismatch, out-of-range indices.
  - `scanAvailableConnections`: length mismatch.
  - `computeReverseTopologicalOrder`: OOB `to` index, length mismatch.
  - `validateStructuralIntegrity`: `numOutputs > numNeurons`, length mismatch.
  - `detectCycles`: length mismatch, `numInputs > numNeurons`.
- Each test asserts a defined result **or** a typed `TopologyError`; any other
  thrown value (uncaught WASM trap) fails the test.
- Manual verification:
  `deno test
  test/wasm/WasmTopologyOpsMalformedBuffers.ts` — 9/9 pass against
  the current `wasm_activation` bundle (trap guard layer); will still pass after
  the bundle bump to NEAT-AI-core #69 (defined error codes layer).
