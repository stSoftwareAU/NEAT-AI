## Summary

Performance validation of synthetic synapses with production-sized creatures
(~1,063 neurons, ~19,653 synapses). Implements a per-target sampling cap to
prevent combinatorial explosion when adjacent layers are wide, and validates
correctness, memory usage, and timing at production scale. Closes #1924.

### Per-target cap (Issue #1924)

Fully connecting adjacent layers in the production creature would add ~160,000
synthetic synapses (e.g., 180 x 220 = 39,600 for one layer pair alone). The new
`maxPerTarget` cap (default: 50) limits each target neuron to at most 50
synthetic inward connections per layer pair, using evenly-spaced deterministic
sampling for good coverage. This reduces synthetic synapses from ~160,000 to
~45,000 — a manageable 3.3x expansion ratio.

### Benchmark results

| Operation                                         | Time (avg) | Notes                            |
| ------------------------------------------------- | ---------- | -------------------------------- |
| Generate synthetic synapses (capped)              | 88.2 ms    | Production scale, default cap=50 |
| Remove synthetic synapses                         | 383.0 ms   | Includes generation + removal    |
| Full lifecycle (generate + train 1 iter + remove) | 1.1 s      | Well within 120s limit           |
| Baseline training (no synthetics)                 | 242.1 ms   | For comparison                   |

Full lifecycle overhead: ~4.6x baseline — acceptable for the connectivity
benefits synthetic synapses provide.

### Memory estimate

| Metric                      | Value  |
| --------------------------- | ------ |
| Original synapses           | 19,653 |
| Synthetic added (capped)    | 45,203 |
| Skipped (capped)            | 95,366 |
| Total synapses              | 64,856 |
| Expansion ratio             | 3.3x   |
| Estimated additional memory | 3.8 MB |

### Correctness validation

- Creature outputs are restored to original values after generate + remove all
  (roundtrip correctness)
- Zero-weight synthetic synapses may affect aggregate neurons (MAXIMUM/MINIMUM)
  during training — this is expected behaviour and does not affect the final
  result after pruning
- Generation is fully deterministic (same creature always produces same
  synthetic synapses)
- Creature validates after every operation (generation, training, removal)

## Evidence

Benchmark results above from `bench/SyntheticSynapsesProductionScale.ts` run on
Apple M4 Pro, Deno 2.7.7. All 4,833+ tests pass with these changes.

## Test Plan

- Added `test/propagate/SyntheticSynapsesProductionScale.ts` (7 tests):
  - Per-target cap limits count at production scale
  - Uncapped vs capped count comparison
  - Creature outputs restored after generate and remove all (roundtrip)
  - Full training lifecycle at production scale
  - Generation is deterministic at production scale
  - Custom maxPerTarget limits connections
  - Memory estimate at production scale
- Added `bench/SyntheticSynapsesProductionScale.ts` (4 benchmarks):
  - Generate (capped)
  - Remove after generation
  - Full lifecycle (generate + train + remove)
  - Baseline training (no synthetics)
- Extracted shared utilities to
  `test/propagate/large/ProductionScaleCreature.ts`
- Existing 33 synthetic synapse tests continue to pass unchanged
