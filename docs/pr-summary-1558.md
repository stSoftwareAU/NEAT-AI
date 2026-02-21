## Summary

Add comprehensive Predictive Coding benchmarks and validation suite. Closes #1558.

This PR adds:
- **Validation tests** (`test/predictiveCoding/validation/`) with 16 tests covering mathematical correctness (energy monotonicity, gradient correctness, backprop equivalence) and backward compatibility (serialisation roundtrip, config migration, standard training unaffected)
- **Benchmark suite** (`bench/predictiveCoding/`) with convergence (PC vs backprop on XOR and regression), speed (inference/gradient/update scaling across network sizes), and evolution (topology efficiency) benchmarks
- **Results documentation** (`docs/PREDICTIVE_CODING_BENCHMARKS.md`) with detailed findings, methodology, and honest reporting of PC overhead

Key findings:
- PC is mathematically correct: energy decreases monotonically, gradients match analytical formulae, update direction aligns with backpropagation
- PC adds 8-80% overhead per training iteration due to inference settling (expected per theory)
- No backward compatibility regression when PC is disabled (the default)
- Inference settling is the bottleneck, motivating the Rust/WASM engine (#1560)

## Evidence

This is a backend/test-only change with no UI. Evidence is provided by:
- All 4316 existing tests pass unchanged (no regression)
- 16 new validation tests pass covering mathematical and compatibility properties
- Benchmark results documented in `docs/PREDICTIVE_CODING_BENCHMARKS.md`
- `./quality.sh` passes cleanly

## Test Plan

### New Validation Tests (`test/predictiveCoding/validation/`)
- `MathematicalValidation.ts` (9 tests):
  - Energy monotonicity for IDENTITY, LOGISTIC, TANH squash functions
  - Gradient correctness vs analytical formula (IDENTITY, LOGISTIC)
  - Backprop equivalence: gradient sign agreement, error reduction
  - Prediction error computation: zero error when latent=prediction, energy formula verification
- `BackwardCompatibility.ts` (7 tests):
  - Serialisation roundtrip after PC inference
  - Squash function preservation through JSON roundtrip
  - Standard backprop unaffected (no PC config, PC explicitly disabled)
  - Default config has PC disabled
  - Creatures without PC history can use PC training

### New Benchmarks (`bench/predictiveCoding/`)
- `convergence.ts`: XOR and regression PC vs backprop comparison
- `speed.ts`: Inference, gradient, and Hebbian update scaling across network sizes
- `evolution.ts`: Topology efficiency across different network structures
