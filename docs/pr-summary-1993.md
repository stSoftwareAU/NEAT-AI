## Summary

Add a discovery scenario test that verifies the discovery process can find a
missing neuron between existing hidden neurons (deep network), not just the
simple "input→hidden→output" pattern. Closes #1993.

The test creates a deeper creature with a chain of 3 hidden neurons (hidden-A →
hidden-B → hidden-C), removes the intermediate hidden-B neuron to create a
crippled creature with a direct connection, and validates that:

- Both creatures are structurally valid
- The cripple degrades outputs (removing the TANH non-linearity matters)
- Error tracing captures meaningful data
- The crippled creature has fewer neurons and synapses
- Discovery would find an "add-neurons" candidate between hidden neurons
  (ignored pending NEAT-AI-Discovery #907)

## Evidence

All 4951 tests pass with 0 failures. The new test file adds 5 active tests and 1
properly ignored test (awaiting Rust FFI support for hidden→hidden neuron
discovery, referencing NEAT-AI-Discovery issue #907).

## Test Plan

- `test/discovery/DiscoveryScenarioAddNeuronBetweenHidden.ts` — 6 tests:
  - Creatures are valid (3 hidden in whole, 2 in crippled)
  - Cripple degrades outputs
  - Tracing captures errors
  - Crippled has fewer neurons
  - Crippled has fewer synapses
  - Discovery finds add-neurons candidate (ignored with issue reference)
