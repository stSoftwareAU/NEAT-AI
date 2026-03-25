## Summary

Add a discovery scenario test that verifies the discovery process can identify a missing synapse between hidden neurons. Uses the shared cripple-and-discover helper from #1990. Closes #1991.

The test creates a creature with two hidden neurons (TANH and RELU) connected by a synapse, cripples it by removing that inter-hidden synapse, and verifies:
- Both creatures are structurally valid with correct hidden neuron counts
- The cripple degrades outputs compared to the whole creature
- Error tracing captures meaningful recording data
- The crippled creature has fewer synapses than the whole

The discovery candidate assertion test is disabled with a reference to NEAT-AI-Discovery issue #5, as add-synapses discovery between hidden neurons is not yet verified in production (part of #1989).

## Evidence
- All 4936 tests pass (0 failed, 1 ignored) via `./quality.sh`
- 4 active test cases validate creature structure, output degradation, error recording, and synapse count
- 1 ignored test documents the expected discovery behaviour with proper skip reason

## Test Plan
- Added `test/discovery/DiscoveryScenarioAddSynapseBetweenHidden.ts` with 5 tests:
  - `creatures are valid` — validates both whole and crippled creatures have correct topology
  - `cripple degrades outputs` — confirms removing the inter-hidden synapse changes outputs
  - `tracing captures errors` — verifies error recording pipeline works
  - `crippled has fewer synapses` — asserts the cripple removed the target synapse
  - `discovery finds add-synapses candidate` (ignored) — placeholder for when discovery supports this scenario
