## Summary

Added a discovery scenario test that verifies the discovery process can find
when a neuron's squash (activation) function has been changed to a suboptimal
one. Closes #1992.

The test uses the shared cripple-and-discover helper from #1990 to:

1. Build a creature with a hidden neuron using a specific squash function (e.g.,
   TANH)
2. Cripple the creature by changing the squash to IDENTITY
3. Validate both creatures are structurally valid
4. Confirm outputs have degraded
5. Record activations/errors via tracing
6. Assert discovery finds a "change-squash" candidate (currently ignored pending
   production verification)

## Evidence

Tests cover four squash pairs: TANH→IDENTITY, RELU→IDENTITY, LOGISTIC→IDENTITY,
and GELU→IDENTITY. Each pair validates that the crippled creature produces
degraded outputs and that tracing captures meaningful error data.

The end-to-end discovery candidate test is properly ignored with a reference to
NEAT-AI-Discovery issue #6, following the established pattern from the
add-synapse-between-hidden scenario test.

## Test Plan

- Added `test/discovery/DiscoveryScenarioChangeSquash.ts` with 11 tests (10
  active, 1 ignored):
  - TANH→IDENTITY: creature validity, output degradation, error tracing,
    topology equivalence
  - RELU→IDENTITY: output degradation, error tracing
  - LOGISTIC→IDENTITY: output degradation, error tracing
  - GELU→IDENTITY: output degradation, error tracing
  - Discovery candidate assertion (ignored pending production support)
