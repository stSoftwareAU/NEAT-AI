## Summary

This PR implements ensemble diversity scoring for species management as part of
the "Brilliant but Brittle" initiative (Issue #1310). The feature encourages
species diversity to reduce reliance on brittle high-performers that dominate
breeding.

### Key Changes

1. **New `EnsembleDiversityScoring` class**
   (`src/breed/EnsembleDiversityScoring.ts`):
   - Measures diversity within species using three metrics:
     - **Weight variance**: Variation in synapse weights and biases across
       species members
     - **Squash entropy**: Shannon entropy of activation function distribution
     - **Topology diversity**: Coefficient of variation in neuron/synapse counts
   - Combines metrics into an overall diversity score (0-1)
   - Provides fitness adjustment based on diversity contribution
   - Supports protection of diverse low-performers from culling
   - Triggers cross-species breeding when diversity is too low
   - Prefers diverse parent combinations during selection

2. **New configuration** (`src/config/EnsembleDiversityConfig.ts`):
   - `enabled`: Whether ensemble diversity scoring is active (default: false)
   - `diversityWeight`: Weight given to diversity in fitness adjustment
     (default: 0.15)
   - `weightVarianceWeight`, `squashEntropyWeight`, `topologyDiversityWeight`:
     Weights for each metric
   - `protectDiverseLowPerformers`: Protect diverse creatures from culling
     (default: false)
   - `crossSpeciesBreedingThreshold`: Trigger cross-species breeding below this
     diversity (default: 0.2)
   - `diverseParentPreferenceWeight`: Prefer genetically distant parent pairs
     (default: 0.2)

3. **Integration with NEAT configuration**:
   - Added `ensembleDiversity` field to `NeatArguments`, `NeatOptions`, and
     `createNeatConfig`
   - All configuration options are fully validated with sensible defaults

4. **Logging support**:
   - `formatMetricsForLogging()`: Formats diversity metrics for display
   - `logSpeciesDiversity()`: Logs species-level diversity with LOW/CROSS-BREED
     indicators
   - `logPopulationDiversitySummary()`: Logs population-wide diversity
     statistics

## Evidence

This is a non-visual, algorithmic enhancement to the NEAT evolutionary
algorithm. The implementation is verified through comprehensive unit tests.

## Test Plan

Added 18 new tests in `test/breed/EnsembleDiversityScoring.ts`:

**Core Diversity Metrics Tests:**

- `calculates weight variance for species` - Verifies diverse creatures have
  higher weight variance
- `calculates squash function entropy` - Verifies diverse activation functions
  increase entropy
- `calculates topology diversity` - Verifies different network structures score
  higher
- `calculates overall diversity score` - Verifies combined metric in [0,1] range

**Fitness Adjustment Tests:**

- `adjusts fitness based on diversity` - Higher diversity → higher adjusted
  fitness
- `disabled returns base fitness` - No adjustment when feature disabled

**Culling Protection Tests:**

- `protects diverse low-performers from culling` - High diversity creatures
  protected
- `protection disabled returns false` - No protection when disabled

**Cross-Species Breeding Tests:**

- `recommends cross-species breeding when diversity is low` - Triggers below
  threshold

**Species-Level Metrics Tests:**

- `calculates species diversity metrics` - All metrics populated correctly
- `identifies low diversity species` - Correct classification based on threshold

**Parent Selection Tests:**

- `calculates genetic distance between creatures` - Distance increases with
  differences
- `prefers diverse parent combinations` - Diverse pairs score higher

**Configuration Tests:**

- `respects configuration weights` - Only enabled metrics affect score
- `isEnabled returns correct value` - Correct enable/disable reporting
- `getConfig returns copy of config` - Configuration retrieval works

**Edge Cases:**

- `handles single creature species` - Zero diversity for single creature
- `handles empty species gracefully` - Zero diversity for empty species

All 2002 existing tests continue to pass, plus the 18 new tests.
