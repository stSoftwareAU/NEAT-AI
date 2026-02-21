# Predictive Coding Benchmarks

Results from the Predictive Coding (PC) benchmark and validation suite.

Issue #1558 | Part of #1549

## Methodology

All benchmarks run on:

- **CPU**: Apple M4 Pro
- **Runtime**: Deno 2.6.10 (aarch64-apple-darwin)
- **Date**: February 2026
- **Branch**: `issue-1558-add-predictive-coding-benchmarks-and-validation-su`

Benchmarks use `Deno.bench()` with default warm-up and iteration settings. Each
benchmark creates fresh creatures with random initial weights to avoid selection
bias.

## 1. Training Convergence

Compares PC training against standard elastic backpropagation on simple problems
with 20 training iterations.

### XOR Problem (2 inputs, 4 hidden neurons, 1 output)

| Method            | time/iter (avg) | iter/s |
| ----------------- | --------------- | ------ |
| Standard backprop | 3.7 ms          | 272.5  |
| Predictive Coding | 4.0 ms          | 248.5  |

**Finding**: PC and backprop are comparable on XOR with these settings. PC is
slightly slower per iteration due to the inference settling loop, but the
difference is modest (~8%).

### Regression (2 inputs, 6 hidden neurons, 1 output, 8 samples)

| Method            | time/iter (avg) | iter/s |
| ----------------- | --------------- | ------ |
| Standard backprop | 5.4 ms          | 184.8  |
| Predictive Coding | 9.5 ms          | 105.5  |

**Finding**: PC is ~1.8x slower per iteration on regression. The settling loop
(50 inference steps per sample) adds overhead compared to single-pass
backpropagation. This is expected and consistent with PC theory — the benefit
comes from improved gradient quality on larger, deeper networks where backprop
signal degradation is significant.

## 2. Inference and Learning Speed

Measures raw PC inference, gradient computation, and weight update speed across
different network sizes.

### PC Inference Settling (50 steps, threshold 1e-6)

| Network Size | Neurons | Synapses | time/iter (avg) | Relative |
| ------------ | ------- | -------- | --------------- | -------- |
| Small        | 7       | 12       | 55.2 us         | 1.0x     |
| Medium       | 37      | 320      | 2.9 ms          | 51.8x    |
| Large        | 93      | 2,090    | 46.8 ms         | 846.7x   |

**Finding**: Inference time scales super-linearly with network size, as
expected. Each inference step recomputes predictions and errors for all
non-input neurons. For large networks, the inner loop dominates. This motivates
the Rust/WASM inference engine (#1560) for production use.

### Gradient Computation

| Network Size      | time/iter (avg) | Relative |
| ----------------- | --------------- | -------- |
| Small (7 neurons) | 2.0 us          | 1.0x     |
| Medium (37)       | 67.7 us         | 33.9x    |
| Large (93)        | 1.0 ms          | 520.8x   |

**Finding**: Gradient computation is cheaper than inference because it is a
single pass over synapses (no iteration). The scaling is dominated by the number
of synapses (quadratic in dense layers).

### Hebbian Weight Update

| Network Size      | time/iter (avg) | Relative |
| ----------------- | --------------- | -------- |
| Small (7 neurons) | 349.5 ns        | 1.0x     |
| Medium (37)       | 8.5 us          | 24.2x    |
| Large (93)        | 58.7 us         | 168.0x   |

**Finding**: Weight updates are very fast — a single pass applying pre-computed
deltas with constraint enforcement. Even for large networks (93 neurons, 2,090
synapses), updates complete in under 60 us.

## 3. Structural Evolution

Measures PC training cost across different network topologies.

### Topology Efficiency (10 iterations, XOR data)

| Topology                | Hidden | time/iter (avg) | Relative |
| ----------------------- | ------ | --------------- | -------- |
| Single layer (4 hidden) | 4      | 2.1 ms          | 1.0x     |
| Single layer (8 hidden) | 8      | 3.5 ms          | 1.7x     |
| Two layers (8+4 hidden) | 12     | 9.2 ms          | 4.5x     |

**Finding**: Multi-layer networks see a larger cost increase because the
inference settling loop must propagate errors across more layers. This is
consistent with PC theory — deeper hierarchies require more settling iterations.
The two-layer network is 4.5x slower despite having only 3x more hidden neurons
than the single-layer baseline.

## 4. Mathematical Validation Summary

The validation test suite (`test/predictiveCoding/validation/`) confirms:

### Energy Monotonicity

- Energy decreases monotonically during inference for IDENTITY, LOGISTIC, and
  TANH activation functions.
- Verified with tolerance of 1e-10 for numerical precision.

### Gradient Correctness

- PC Hebbian weight gradients match the analytical formula:
  `dW(j->i) = f'(a_i) * epsilon_i * x_j`
- Verified for both IDENTITY (f'=1) and LOGISTIC (f'=sigma*(1-sigma)) activation
  functions.

### Backprop Equivalence

- PC weight update direction matches backpropagation gradient direction on
  feedforward networks (positive correlation in update direction).
- A single PC learning step reduces MSE output error, confirming that PC updates
  move weights in a beneficial direction.
- This is consistent with Millidge et al. (2022c): "Predictive Coding
  Approximates Backprop Along Arbitrary Computation Graphs".

### Prediction Error Computation

- Energy is exactly zero when latent values equal predictions.
- Total energy correctly implements E = 0.5 * sum(epsilon^2).

## 5. Backward Compatibility

Validation tests confirm:

- Creature serialisation/deserialisation is unaffected by PC state.
- Squash functions are preserved through JSON roundtrip after PC inference.
- Training without PC config uses standard backprop (no regression).
- Explicitly disabling PC uses standard backprop.
- Default PC config has `enabled: false`.
- Creatures without PC history can be trained with PC enabled.

## Conclusions

1. **PC works correctly**: Mathematical validation confirms energy minimisation,
   correct gradients, and backprop-equivalent update directions.

2. **PC is slower per iteration**: On small problems, PC adds 8-80% overhead per
   training iteration due to the inference settling loop. This is expected and
   acceptable for the benefits PC provides on larger, deeper networks.

3. **Inference dominates cost**: The settling loop (not gradient computation or
   weight updates) is the bottleneck. The Rust/WASM inference engine (#1560)
   will address this.

4. **No backward compatibility regression**: All existing functionality works
   identically with PC disabled (the default).

5. **PC training reduces error**: Validation confirms that PC weight updates
   move weights in the correct direction, reducing output error.

## References

- Millidge, B., Seth, A., & Buckley, C. L. (2022c). "Predictive Coding
  Approximates Backprop Along Arbitrary Computation Graphs."
- Salvatori, T., et al. (2024). "A Stable, Fast, and Fully Automatic Learning
  Algorithm for Predictive Coding Networks."
