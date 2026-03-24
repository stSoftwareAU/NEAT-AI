## Summary

Merge the `milestone/ts-rust-migration` branch into `Develop`, completing the
TS→Rust migration milestone. Closes #1986.

This milestone delivered the following completed work:

- **#1952**: Production-scale backpropagation benchmark (1,164 neurons, 19,039
  synapses)
- **#1953**: DRY removal of duplicate TS fallback code for Weight/Bias WASM
  calculations
- **#1954**: Topological backpropagation loop migrated to Rust/WASM
- **#1955**: Production performance gains validated from TS→Rust migration
- **#1956**: Milestone roadmap created for TS→Rust migration
- **#1957**: Typed array topology replacing JS object topology
- **#1958**: Integer neuron IDs replacing UUID strings
- **#1959**: Selective WASM residency for read-heavy topology operations
- **#1960**: Batch API design for amortising WASM boundary crossing
- **#1961**: Topology validation migrated to Rust/WASM

Additionally fixed a flaky Score test that was causing CI failure. The test
"calculate - large weights increase penalty" had a score difference of only
~0.00001 due to the `growthCost/100` multiplier, which was lost under WASM on
CI. Fixed by using deterministic biases and a larger `growthCost`.

## Evidence

All 4925 tests pass after the fix. Quality gate (`quality.sh`) passes cleanly.

## Test Plan

- Modified `test/architecture/Score.ts`: "calculate - large weights increase
  penalty" now uses deterministic biases and a larger growthCost
- All existing tests (4925) pass after the merge
- New tests added during the milestone cover typed topology, integer neuron IDs,
  WASM batch operations, WASM topology operations, WASM structural validation,
  and WASM topological backpropagation
