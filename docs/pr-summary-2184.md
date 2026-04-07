## Summary

Add GRQ-25-1 and Europa sample creature fixtures for inter-species breeding tests. These fixtures represent worst-case genetic incompatibility: zero shared hidden neuron UUIDs, radically different topologies (sparse/deep vs dense/shallow), different UUID formats (legacy vs UUID-v4), and different memetic data presence. Closes #2184.

## Evidence

- GRQ-25-1: 60 hidden neurons, 139 synapses, legacy UUID format, no memetic data
- Europa: 20 hidden neurons, 202 synapses, UUID-v4 format, with memetic data
- Both have matching input (3) and output (2) counts for breeding compatibility
- `geneticCompatibility()` returns 0 for the pair (zero shared hidden neuron UUIDs)
- Both fixtures load and pass `creatureValidate()` successfully
- All 5330 tests pass including 5 new fixture validation tests

## Test Plan

- `test/data/SampleCreatureFixtures.ts` — 5 tests:
  - GRQ-25-1 fixture loads and validates (sparse, deep, legacy UUID, no memetic data)
  - Europa fixture loads and validates (dense, shallow, UUID-v4, with memetic data)
  - Both fixtures have the same input/output counts
  - Genetic compatibility returns 0 for the pair
  - GRQ-25-1 is sparse and deep relative to Europa (synapse density comparison)
