## Summary

Update predictive coding documentation with production validation details,
configuration guide, troubleshooting guidance, and complex creature benchmark
results. Closes #1916.

### Changes

**`docs/PREDICTIVE_CODING.md`**:

- Added **Production Validation** section (Section 5) documenting how to verify
  PC is active by checking trace tags (`approach`, `pc-energy`,
  `pc-inference-steps`, `pc-changed`) with code examples and interpretation
  guidance
- Added **Configuration Guide** section (Section 6) with recommended settings
  for small (< 10 neurons), medium (10–50), and large (50+) networks, including
  adaptive scaling explanation and parameter relationship documentation
- Added **Troubleshooting** section (Section 7) covering "no improvement",
  "slower than expected", and "energy not decreasing" scenarios

**`docs/PREDICTIVE_CODING_BENCHMARKS.md`**:

- Added **Complex Creature Results** section (Section 6) with benchmark results
  for 30+ neuron creatures from #1914
- Added PC vs standard backprop comparison table for non-trivial problems
- Documented configuration tuning findings from #1915 (adaptive scaling)
- Updated conclusions with complex creature findings (points 6 and 7)

All documentation uses Australian English spelling throughout.

## Evidence

This is a documentation-only change. The underlying code features (trace tags
from #1913, adaptive scaling from #1915, complex creature tests from #1927,
convergence fix from #1928) are already implemented and tested. Existing tests
cover all documented functionality:

- `test/predictiveCoding/PredictiveCodingTags.ts` — trace tag verification
- `test/predictiveCoding/AdaptiveScaling.ts` — adaptive scaling behaviour
- `test/predictiveCoding/ComplexCreatureIntegration.ts` — complex creature
  integration

## Test Plan

- No new tests added — this is a documentation-only change
- Existing test suite covers all documented functionality
- `quality.sh --lint-only` passes cleanly (formatting and linting verified)
