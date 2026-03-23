## Summary

Add production-scale backpropagation benchmark (1,164 hidden neurons, 19,500 synapses)
to establish the baseline for evaluating TS → Rust/WASM migration gains. Closes #1952.

## Evidence

### Network Configuration
- 1,176 total neurons (1,164 hidden across 6 layers: 200 → 250 → 250 → 200 → 150 → 114)
- 19,500 synapses with sparse connectivity (maxFanOut=18)
- Seeded random generator for reproducibility

### Benchmark Results (Apple M4, Deno 2.7.7)

| Benchmark                | avg/iter | iter/s |
| ------------------------ | -------- | ------ |
| Full backprop            | 6.0 ms   | 166.6  |
| Propagate only           | 5.1 ms   | 194.9  |
| Activate only            | 716.4 µs | 1,396  |
| Propagate (error only)   | 3.7 ms   | 270.7  |
| Propagate (full)         | 5.1 ms   | 194.5  |

### Key Findings
- Propagation (backward pass) accounts for ~85% of total backprop time — primary optimisation target
- Forward activation is ~7x faster than backward propagation
- Error-only propagation is ~1.39x faster than full propagation with gradient accumulation

## Test Plan

- Benchmark runs with `deno bench --allow-read --allow-env bench/ProductionScaleBackprop.ts`
- Produces stable, reproducible timing results via seeded random generator
- Completes in under 2 minutes
- Baseline results documented in `bench/results/production-scale-baseline.md`
