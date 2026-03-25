## Summary

Add discovery scenario test for coordinated structural changes. This test
verifies that the discovery process can identify compound degradations that
require multiple coordinated operations to repair (the "coordinated-structural"
discovery type). Closes #1996.

The test creates a creature with two input paths converging on a hidden neuron,
then cripples it by changing a bias and degrading a synapse weight. It validates
that the creature remains structurally valid while producing degraded outputs,
and that tracing captures meaningful error data. A mock-based discovery test is
included (currently ignored pending Rust FFI verification).

## Evidence

All 4967 tests pass via `./quality.sh`, including 6 new tests (1 ignored).

## Test Plan

New tests in `test/discovery/DiscoveryScenarioCoordinatedStructural.ts`:
- `coordinated structural - creatures are valid` — validates both whole and crippled creatures
- `coordinated structural - cripple degrades outputs` — confirms degradation produces different outputs
- `coordinated structural - tracing captures errors` — verifies error recording pipeline
- `coordinated structural - same topology, different parameters` — confirms degradation is parametric not structural
- `coordinated structural - bias was changed` — verifies bias degradation on hidden-A
- `coordinated structural - multiple degradations confirmed` — confirms both bias and weight degradations
- `coordinated structural - discovery finds coordinated-structural candidate` (ignored) — mock-based coordinated-structural candidate test
