# PR Summary — Issue #2419

## Summary

Refresh contributor-facing documentation to reflect the NEAT-AI-core integration
changes adopted in Issues #2415 and #2416 — topology helpers, the topological
backprop loop, and elastic distribution are all WASM-only with no TypeScript
fallback. Also confirms the parity gate scope is unchanged after the fallback
removals.

Closes #2419 (partial — see "Deferred" below).

## Changes

- **AGENTS.md**
  - "Project Architecture → Directory Structure": clarify that `src/propagate/`
    keeps TS orchestration but the topological backprop loop and elastic
    distribution live in WASM.
  - Add a new "WASM-only operations (no TS fallback)" subsection under
    "Activation / WASM" listing the WASM-backed surfaces and the
    `requireWasm(...)` fail-fast contract.
  - Extend the "NEAT-AI-core Dependency Policy" rules with rule 8: do not
    reintroduce `*TS` fallbacks for core-owned operations — the parity gate is
    the only alignment check.

- **docs/PARITY_GATE.md**
  - Add a note clarifying that the gate's scope is unchanged after the fallback
    removals: `WasmJsScoreParity.ts` and `MSE.ts` remain the only TS-side
    surfaces that cross the native boundary in a way that could drift
    independently.

- **docs/CORE_DEPENDENCY_POLICY.md** — confirmed unchanged. The artifact-based
  sync flow described there still matches `build.sh` exactly after the rev bump
  in #2414.

## Deferred

**README.md DOT/JSON section** — the issue's acceptance criterion to "mention
the new DOT/JSON export capability with a minimal example" depends on the
`exportTopologyDot` / `exportTopologyJson` wrappers added in **#2417**. That
issue is still open, the upstream `to_dot` / `to_topology_json` exports are not
yet present in `wasm_activation/pkg/wasm_activation.d.ts` (current pin
`36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959`), and the TS wrappers do not exist.
Adding a code snippet now would be either incorrect (referencing non-existent
functions) or a no-op stub. The README section should land together with the
wrapper implementation in #2417's PR so the example matches the public API.

## Evidence

This is a documentation-only change with no UI surface. Verified via:

- `./quality.sh --lint-only < /dev/null` — passes (formatting, linting, bash
  syntax check all clean).
- Confirmed no remaining references to deleted TS symbols (`validateTopologyTS`,
  `scanAvailableConnectionsTS`, `computeReverseTopologicalOrderTS`,
  `validateStructuralIntegrityTS`, `detectCyclesTS`,
  `src/propagate/TopologicalOrder.ts`) in active docs. The only matches are in
  historical PR-summary files (`docs/pr-summary-2415.md`,
  `docs/archive/pr-summaries/pr-summary-1641.md`) whose purpose is to record
  those past changes — leaving them intact is correct.

## Test Plan

- [x] `./quality.sh --lint-only < /dev/null`
- [x] Spot-check that `AGENTS.md` no longer implies a TS fallback for topology /
      backprop / elastic distribution.
- [x] Spot-check that the parity gate note does not change the gate's command
      list — only adds context.
