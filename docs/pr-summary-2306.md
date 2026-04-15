## Summary

Create production-scale profiling fixtures matching GRQ-cluster dimensions so that profiling results reflect real-world bottlenecks rather than small-data artefacts. Closes #2306.

### Changes

1. **Enhanced `ProductionScaleCreature.ts`** with configurable scale presets:
   - Added `CreatureScaleOptions` interface with `"default"` and `"grq-cluster"` presets
   - `"grq-cluster"` preset generates ~1,500 neurons and ~20,000 synapses (matching production `performance.csv` dimensions)
   - Default preset remains unchanged (~1,060 neurons, ~18,000 synapses) — fully backward-compatible
   - Connectivity density is scale-dependent to achieve target synapse counts

2. **Created `bench/fixtures/generateProductionFixtures.ts`** — a deterministic fixture generator that:
   - Generates creature JSON matching GRQ-cluster dimensions (648 inputs, 2 outputs)
   - Generates 520+ binary training data files with configurable record counts
   - Uses seeded PRNG (mulberry32) for reproducible output
   - Writes all output to `.hidden/` (gitignored) — no large files committed
   - Includes CLI argument parsing and usage documentation in the script header
   - Integrates directly with `profileEvolveDir.ts` via `--creature` and `--data` flags

3. **Created comprehensive test suite** (`test/bench/fixtures/GenerateProductionFixtures.ts`) with 10 tests covering:
   - Neuron count within GRQ-cluster range (~1,400–1,700)
   - Synapse count within GRQ-cluster range (~18,000–22,000)
   - Deterministic generation (identical output from same seed)
   - Default scale backward compatibility
   - Correct binary file count and byte sizes
   - Diverse squash function representation (15+ distinct functions)

## Evidence

This is a backend/CLI fixture generator with no web UI. Evidence is from test output:

- **All 5,853 tests pass** (0 failed, 3 ignored) including 10 new fixture tests and 4 existing production-scale tests
- Generated creature: **1,492 neurons, 19,968 synapses** (targets: ~1,500 / ~19,850)
- Quality gate passes cleanly: formatting, linting, type-checking, and all tests

## Test Plan

- `test/bench/fixtures/GenerateProductionFixtures.ts` — 10 new tests:
  - `GRQ-cluster creature has ~1,500 neurons`
  - `GRQ-cluster creature has ~20,000 synapses`
  - `GRQ-cluster creature generation is deterministic`
  - `default scale unchanged (~1,060 neurons)` — backward compatibility
  - `creature fixture writes valid JSON file`
  - `training data generator produces correct file count`
  - `training data binary files have correct byte sizes`
  - `training data generation is deterministic`
  - `generateAllFixtures produces complete result`
  - `GRQ-cluster creature has diverse squash functions`
- Existing `test/propagate/large/ProductionScale.ts` — all 4 tests continue to pass
