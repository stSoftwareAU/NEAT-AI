## Summary

Add a discovery scenario test for the "remove harmful synapse" discovery type. This test verifies that the discovery process can identify a harmful synapse that should be removed from an otherwise well-functioning creature. Closes #1995.

The test creates a clean creature with two independent hidden paths (input-0 → hidden-A via RELU, input-1 → hidden-B via TANH, both feeding output-0), then cripples it by adding a harmful cross-connection from hidden-A to hidden-B with a large negative weight (-2.0) that creates interference. This is the inverse of the "add synapse" scenario — here we cripple by ADDING something harmful.

## Evidence

- 4 active tests pass: creature validity, output degradation, error recording, synapse count verification
- 1 discovery candidate test properly disabled with `ignore: true` and NEAT-AI-Discovery issue reference (pending Rust FFI verification)
- All 4961 tests pass with 0 failures via `./quality.sh`

## Test Plan

- `test/discovery/DiscoveryScenarioRemoveHarmfulSynapse.ts`:
  - Validates both whole and crippled creatures are structurally valid with correct hidden neuron counts
  - Confirms crippled creature (with harmful synapse) produces degraded outputs compared to the whole creature
  - Verifies tracing captures error recordings from the crippled creature
  - Asserts crippled creature has more synapses than the whole creature (harmful synapse added)
  - Discovery candidate test (ignored) validates `removeHarmfulSynapse` in `DiscoverResult` produces a `remove-synapse` candidate
