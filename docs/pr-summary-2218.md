## Summary

Add unit tests for `GeneticCompatibility` and `AdaptiveTournamentSize` breeding
modules. These are core NEAT mechanisms that previously lacked dedicated test
files at the paths specified in the issue. Closes #2218.

## Evidence

All 26 new tests pass. Full quality gate (`./quality.sh`) passes with 5485
tests, 0 failures.

## Test Plan

### `test/breed/GeneticCompatibility.ts` (15 tests)
- Identical creatures have compatibility 1.0
- Added/removed neurons reduce compatibility appropriately
- Partial overlap yields correct fractional value
- Same topology with different weights still yields 1.0 (structural only)
- Same topology with different biases still yields 1.0
- Symmetry: `distance(a, b) === distance(b, a)` for unequal and disjoint sets
- Compatibility decreases monotonically with structural divergence (5-step gradient)
- Minimal creature (input-to-output only) yields 1.0
- Minimal vs deep creature yields 1.0 (empty smallest set)
- Creatures with many hidden layers (20 neurons, 50% overlap)
- Single hidden neuron match and mismatch
- Result always in [0, 1] across varied configurations

### `test/breed/AdaptiveTournamentSize.ts` (11 tests)
- Expected sizes across population range (formula verification)
- Boundary conditions: single-member, two-member, population of 3, very large
- Always returns a positive integer
- Never exceeds population size
- Monotonically non-decreasing
- Larger populations produce equal or larger tournaments
- Coverage percentage stays within 1-15% for populations above 100
- Matches formula `max(3, min(floor(sqrt(pop)), floor(pop * 0.1)))`
