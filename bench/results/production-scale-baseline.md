# Production-scale Backpropagation Baseline

Issue #1952 — baseline results for evaluating TS → Rust/WASM migration gains.

## Network Configuration

| Parameter      | Value                                |
| -------------- | ------------------------------------ |
| Inputs         | 8                                    |
| Outputs        | 4                                    |
| Hidden layers  | 200 → 250 → 250 → 200 → 150 → 114    |
| Hidden neurons | 1,164                                |
| Total neurons  | 1,176                                |
| Synapses       | 19,500                               |
| Max fan-out    | 18                                   |
| Connectivity   | Sparse (seeded random, reproducible) |

## Environment

| Property | Value                             |
| -------- | --------------------------------- |
| CPU      | Apple M4                          |
| Runtime  | Deno 2.7.7 (aarch64-apple-darwin) |
| Date     | 2026-03-23                        |

## Baseline Results

### Full Backprop Pass (activate + trace + propagate)

| Benchmark                    | avg/iter | iter/s | min    | max     | p75    | p99     |
| ---------------------------- | -------- | ------ | ------ | ------- | ------ | ------- |
| Full backprop (1176N/19500S) | 6.0 ms   | 166.6  | 5.4 ms | 12.0 ms | 5.9 ms | 12.0 ms |

### Propagation Only (backward pass)

| Benchmark                     | avg/iter | iter/s | min    | max    | p75    | p99    |
| ----------------------------- | -------- | ------ | ------ | ------ | ------ | ------ |
| Propagate only (1176N/19500S) | 5.1 ms   | 194.9  | 4.9 ms | 6.2 ms | 5.2 ms | 5.9 ms |

### Activation Only (forward pass)

| Benchmark                    | avg/iter | iter/s | min      | max      | p75      | p99      |
| ---------------------------- | -------- | ------ | -------- | -------- | -------- | -------- |
| Activate only (1176N/19500S) | 716.4 µs | 1,396  | 698.0 µs | 950.5 µs | 720.2 µs | 781.8 µs |

### Propagation Breakdown (error only vs full accumulation)

| Benchmark              | avg/iter | iter/s | min    | max    | p75    | p99    |
| ---------------------- | -------- | ------ | ------ | ------ | ------ | ------ |
| Propagate (error only) | 3.7 ms   | 270.7  | 3.5 ms | 5.1 ms | 3.7 ms | 4.3 ms |
| Propagate (full)       | 5.1 ms   | 194.5  | 4.8 ms | 8.7 ms | 5.2 ms | 8.1 ms |

**Summary:** Error-only propagation is ~1.39x faster than full propagation.

## Key Observations

1. **Propagation dominates**: The backward pass (~5.1 ms) accounts for ~85% of
   total backprop time (~6.0 ms), making it the primary optimisation target.
2. **Activation is fast**: The forward pass (~716 µs) is roughly 7x faster than
   propagation, suggesting WASM migration effort is better directed at the
   backward pass.
3. **Weight/bias accumulation overhead**: Full propagation is ~1.39x slower than
   error-only propagation, indicating that gradient accumulation adds meaningful
   overhead.

## How to Reproduce

```bash
deno bench --allow-read --allow-env bench/ProductionScaleBackprop.ts
```
