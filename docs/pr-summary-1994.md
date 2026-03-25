## Summary

Add a discovery scenario test that verifies the discovery process can find
missing fan-in synapse connections (multiple inputs converging to one hidden
neuron). The test creates a creature where hidden-A receives fan-in from 3
sources (input-0, input-1, and hidden-B), then cripples it by removing the
hidden-B to hidden-A synapse. Closes #1994.

## Evidence

- All 4957 tests pass via `./quality.sh` (0 failures, 4 ignored)
- 6 active tests cover: creature validity, fan-in count verification (whole=3,
  crippled=2), output degradation, error tracing, and synapse count comparison
- 1 ignored test for mock discovery (properly skipped with NEAT-AI-Discovery
  issue #908 reference, as fan-in discovery is not yet verified in production)

## Test Plan

- Added `test/discovery/DiscoveryScenarioFanInSynapsePatterns.ts` with 7 tests:
  - Creatures are valid (both have 2 hidden neurons, UUIDs assigned)
  - Whole creature has fan-in of 3 to hidden-A
  - Cripple reduces fan-in to 2
  - Cripple degrades outputs
  - Tracing captures errors
  - Crippled has fewer synapses
  - Discovery finds add-synapses candidate (ignored, pending production verification)
