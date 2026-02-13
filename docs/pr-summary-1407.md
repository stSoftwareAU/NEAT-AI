## Summary

Add comprehensive unit tests for architecture core modules that previously
lacked direct test coverage. Closes #1407.

Six new test files covering foundational data structures, state management,
scoring, breeding, and utility functions:

- **DenseNumberMap** (20 tests) - set/get/has/clear, auto-growth, chaining,
  edge values (zero, negative, epsilon), boundary conditions
- **CreatureState & NeuronState** (20 tests) - initialisation defaults,
  activation tracing with non-finite value protection (Issue #1314),
  lazy Map creation, makeActivation with/without feedback, error collection
- **Score** (25 tests) - valuePenalty boundaries and compression, calculate
  with varying error/growth cost/complexity, caching, incremental weight/bias
  updates, input validation (NaN, Infinity, negative)
- **ElitismUtils** (18 tests) - sortCreaturesByScore ordering, makeElitists
  size clamping and validation, logVerbose average calculation and tag
  management (trainID, notified, CRISPR)
- **Offspring** (10 tests) - compatible parent breeding, incompatible
  species rejection, clone detection, synapse validity, UUID assignment,
  forwardOnly enforcement, cloneConnections, sortNeurons ordering
- **CreatureUtils** (14 tests) - deterministic UUID generation, tag
  exclusion from UUID, topology hash consistency across weight changes,
  different topology detection, hash caching, Fisher-Yates shuffle
  preservation

## Evidence

This is a test-only change with no UI or performance modifications.
All 3013 tests pass (including 107 new tests) with `./quality.sh`.

## Test Plan

- `test/architecture/DenseNumberMap.ts` - 20 tests
- `test/architecture/CreatureState.ts` - 20 tests
- `test/architecture/Score.ts` - 25 tests
- `test/architecture/ElitismUtils.ts` - 18 tests
- `test/architecture/Offspring.ts` - 10 tests
- `test/architecture/CreatureUtils.ts` - 14 tests
