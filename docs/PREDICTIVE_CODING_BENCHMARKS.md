# 📊 Predictive Coding Benchmarks

> **Brief**: Benchmark companion to
> [PREDICTIVE_CODING.md](./PREDICTIVE_CODING.md). Every number on this page is
> produced by a script under
> [`bench/predictiveCoding/`](../bench/predictiveCoding/) — if a number drifts,
> refresh it from the script rather than editing it by hand. Numbers from a
> previous bench run are kept in place with their date / issue reference for
> historical comparison; do not delete them.

Results from the Predictive Coding (PC) benchmark and validation suite.

Issue [#1558](https://github.com/stSoftwareAU/NEAT-AI/issues/1558) | Part of
[#1549](https://github.com/stSoftwareAU/NEAT-AI/issues/1549) | Complex creature
results from [#1914](https://github.com/stSoftwareAU/NEAT-AI/issues/1914) and
[#1915](https://github.com/stSoftwareAU/NEAT-AI/issues/1915).

## 📑 In this cluster

- **[PREDICTIVE_CODING.md](./PREDICTIVE_CODING.md)** — parent doc; theory and
  architecture for PC.
- **PREDICTIVE_CODING_BENCHMARKS.md** (this file) — benchmark numbers, scaling
  behaviour, and validation results.
- **[PERFORMANCE_RESEARCH.md](./PERFORMANCE_RESEARCH.md)** — wider performance
  optimisation log (frames where PC sits in the pipeline).
- **[PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md)** — operational tuning
  knobs for the memetic training loop that PC plugs into.

See the [docs index](./README.md) for the full topic map.

## 🧪 Acronyms used in this guide

- **PC** — Predictive Coding
- **CPU** / **GPU** — Central / Graphics Processing Unit
- **WASM** — WebAssembly
- **MSE / MAE / RMSE** — Mean Squared / Absolute / Root-Mean-Squared Error
- **L2 norm** — Euclidean norm of a vector

## 🛣️ How a PC benchmark is produced

```mermaid
flowchart LR
    A[bench/predictiveCoding/<br/>convergence.ts · speed.ts · evolution.ts] --> B[deno bench]
    B --> C[📊 Per-iteration<br/>timings + iter/s]
    C --> D[Compare to<br/>standard backprop]
    D --> E[📝 Update tables<br/>in this doc]
```

## 🔬 Methodology

All benchmarks run on:

- **CPU**: Apple M4 Pro
- **Runtime**: Deno 2.6.10 (aarch64-apple-darwin)
- **Date**: February 2026 (issue
  [#1558](https://github.com/stSoftwareAU/NEAT-AI/issues/1558))
- **Branch**: `issue-1558-add-predictive-coding-benchmarks-and-validation-su`

Benchmarks use `Deno.bench()` with default warm-up and iteration settings. Each
benchmark creates fresh creatures with random initial weights to avoid selection
bias.

The three bench scripts that produce the numbers below are:

- **Convergence** —
  [`bench/predictiveCoding/convergence.ts`](../bench/predictiveCoding/convergence.ts)
  (XOR + regression, 20 iterations)
- **Speed** —
  [`bench/predictiveCoding/speed.ts`](../bench/predictiveCoding/speed.ts) (raw
  inference settling, gradient computation, Hebbian update)
- **Evolution** —
  [`bench/predictiveCoding/evolution.ts`](../bench/predictiveCoding/evolution.ts)
  (topology efficiency)

Run any one of them with:

```bash
deno bench --allow-read --allow-write --allow-env --allow-ffi \
  bench/predictiveCoding/<script>.ts
```

> [!NOTE]
> All benchmarks were run on an Apple M4 Pro using Deno 2.6.10. Results will
> differ on other hardware and runtimes. The relative comparisons between
> methods (e.g., PC vs standard backprop) are more meaningful than the absolute
> timings, which are hardware-specific. If a fresh run produces materially
> different numbers, **append the new figures and date them** rather than
> overwriting the existing rows — historical trend matters for negative-result
> investigations.

## 1. 📈 Training Convergence

_Source bench script:_
[`bench/predictiveCoding/convergence.ts`](../bench/predictiveCoding/convergence.ts).

Compares PC training against standard elastic backpropagation on simple problems
with 20 training iterations.

### 🧩 XOR Problem (2 inputs, 4 hidden neurons, 1 output)

| Method            | time/iter (avg) | iter/s |
| ----------------- | --------------- | ------ |
| Standard backprop | 3.7 ms          | 272.5  |
| Predictive Coding | 4.0 ms          | 248.5  |

**Finding**: PC and backprop are comparable on XOR with these settings. PC is
slightly slower per iteration due to the inference settling loop, but the
difference is modest (~8%).

### 📉 Regression (2 inputs, 6 hidden neurons, 1 output, 8 samples)

| Method            | time/iter (avg) | iter/s |
| ----------------- | --------------- | ------ |
| Standard backprop | 5.4 ms          | 184.8  |
| Predictive Coding | 9.5 ms          | 105.5  |

**Finding**: PC is ~1.8x slower per iteration on regression. The settling loop
(50 inference steps per sample) adds overhead compared to single-pass
backpropagation. This is expected and consistent with PC theory — the benefit
comes from improved gradient quality on larger, deeper networks where backprop
signal degradation is significant.

> [!TIP]
> PC's overhead on small problems (8–80% slower per iteration) is acceptable
> given the improved gradient quality it provides on larger and deeper networks.
> For networks with 30+ neurons or 2+ layers, PC's benefits in update direction
> correctness outweigh the settling cost — especially once the Rust/WASM
> inference engine (#1560) is in place.

#### 🔁 Re-verification — June 2026 (Issue #2965)

Re-run on Apple M4 Pro, **Deno 2.8.3**, to confirm the numbers reproduce. The
February 2026 rows above are retained for historical comparison. Figures are
within noise of the original run; on XOR, PC was marginally faster on this run.

| Problem    | Method            | time/iter (avg) | iter/s |
| ---------- | ----------------- | --------------- | ------ |
| XOR        | Standard backprop | 4.0 ms          | 249.5  |
| XOR        | Predictive Coding | 3.7 ms          | 266.8  |
| Regression | Standard backprop | 5.8 ms          | 171.4  |
| Regression | Predictive Coding | 8.6 ms          | 115.9  |

**Finding**: Reproducible. PC ≈ backprop on XOR (~1.07× either way, within run
variance) and ~1.48× slower on regression — consistent with the original finding
that PC's settling overhead is modest on small networks.

## 2. ⚡ Inference and Learning Speed

_Source bench script:_
[`bench/predictiveCoding/speed.ts`](../bench/predictiveCoding/speed.ts).

Measures raw PC inference, gradient computation, and weight update speed across
different network sizes.

### 🔄 PC Inference Settling (50 steps, threshold 1e-6)

| Network Size | Neurons | Synapses | time/iter (avg) | Relative |
| ------------ | ------- | -------- | --------------- | -------- |
| Small        | 7       | 12       | 55.2 us         | 1.0x     |
| Medium       | 37      | 320      | 2.9 ms          | 51.8x    |
| Large        | 93      | 2,090    | 46.8 ms         | 846.7x   |

**Finding**: Inference time scales super-linearly with network size, as
expected. Each inference step recomputes predictions and errors for all
non-input neurons. For large networks, the inner loop dominates. This motivates
the Rust/WASM inference engine (#1560) for production use.

> [!WARNING]
> Inference settling time scales super-linearly with network size. A large
> network (93 neurons, 2,090 synapses) is ~847x slower than a small one (7
> neurons) at 50 settling steps. Do not use the TypeScript PC prototype for
> production training of large or medium networks — the Rust/WASM engine (#1560)
> is required for acceptable performance.

### 📐 Gradient Computation

| Network Size      | time/iter (avg) | Relative |
| ----------------- | --------------- | -------- |
| Small (7 neurons) | 2.0 us          | 1.0x     |
| Medium (37)       | 67.7 us         | 33.9x    |
| Large (93)        | 1.0 ms          | 520.8x   |

**Finding**: Gradient computation is cheaper than inference because it is a
single pass over synapses (no iteration). The scaling is dominated by the number
of synapses (quadratic in dense layers).

### 🧬 Hebbian Weight Update

| Network Size      | time/iter (avg) | Relative |
| ----------------- | --------------- | -------- |
| Small (7 neurons) | 349.5 ns        | 1.0x     |
| Medium (37)       | 8.5 us          | 24.2x    |
| Large (93)        | 58.7 us         | 168.0x   |

**Finding**: Weight updates are very fast — a single pass applying pre-computed
deltas with constraint enforcement. Even for large networks (93 neurons, 2,090
synapses), updates complete in under 60 us.

### 🔁 Re-verification — June 2026 (Issue #2965)

Re-run on Apple M4 Pro, **Deno 2.8.3**. Numbers reproduce within
hardware/runtime noise; the February 2026 rows above are retained for
comparison.

| Stage          | Small (7) | Medium (37) | Large (93) |
| -------------- | --------- | ----------- | ---------- |
| Inference (50) | 36.7 us   | 2.4 ms      | 38.1 ms    |
| Gradient comp. | 1.2 us    | 54.0 us     | 745.8 us   |
| Hebbian update | 326.5 ns  | 8.5 us      | 54.3 us    |

**Finding**: Reproducible. Inference still dominates and scales super-linearly;
gradient computation and Hebbian updates remain cheap (large-network Hebbian
update still under 60 us). This continues to motivate the planned Rust/WASM
inference engine (#1560) for production-scale networks.

## 3. 🏗️ Structural Evolution

_Source bench script:_
[`bench/predictiveCoding/evolution.ts`](../bench/predictiveCoding/evolution.ts).

Measures PC training cost across different network topologies.

### 🔢 Topology Efficiency (10 iterations, XOR data)

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

## 4. ✅ Mathematical Validation Summary

The validation test suite (`test/predictiveCoding/validation/`) confirms:

### 📉 Energy Monotonicity

- Energy decreases monotonically during inference for IDENTITY, LOGISTIC, and
  TANH activation functions.
- Verified with tolerance of 1e-10 for numerical precision.

### 🎯 Gradient Correctness

- PC Hebbian weight gradients match the analytical formula:
  `dW(j->i) = f'(a_i) * epsilon_i * x_j`
- Verified for both IDENTITY (f'=1) and LOGISTIC (f'=sigma*(1-sigma)) activation
  functions.

### 🔗 Backprop Equivalence

- PC weight update direction matches backpropagation gradient direction on
  feedforward networks (positive correlation in update direction).
- A single PC learning step reduces MSE output error, confirming that PC updates
  move weights in a beneficial direction.
- This is consistent with Millidge et al. (2022c): "Predictive Coding
  Approximates Backprop Along Arbitrary Computation Graphs".

### ⚙️ Prediction Error Computation

- Energy is exactly zero when latent values equal predictions.
- Total energy correctly implements E = 0.5 * sum(epsilon^2).

> [!NOTE]
> The mathematical validation suite confirms that PC is implemented correctly:
> energy decreases monotonically during settling, gradients match the analytical
> formula, and weight update directions agree with backpropagation. These
> properties are necessary (though not sufficient) to ensure PC training
> converges reliably on real problems.

## 5. 🔒 Backward Compatibility

Validation tests confirm:

- Creature serialisation/deserialisation is unaffected by PC state.
- Squash functions are preserved through JSON roundtrip after PC inference.
- Training without PC config uses standard backprop (no regression).
- Explicitly disabling PC uses standard backprop.
- Default PC config has `enabled: false`.
- Creatures without PC history can be trained with PC enabled.

> [!TIP]
> Backward compatibility is fully preserved. Existing creatures serialised
> without PC state can be loaded and trained with PC enabled, and vice versa.
> The `enabled: false` default means no existing pipelines are affected unless
> PC is explicitly opted in via configuration.

## 6. 🧬 Complex Creature Results (30+ Neurons)

Issue #1914 and #1915 extended PC validation to production-representative
creatures with 30+ hidden neurons, multiple layers, and mixed activation
functions. These results demonstrate that PC with adaptive scaling (Issue #1915)
produces measurable improvement on non-trivial networks.

### 🏗️ Test Topology

The complex creature topology mirrors production-scale workloads:

- **Inputs**: 4
- **Hidden layers**: 4 (12 → 10 → 8 → 6 neurons)
- **Total hidden neurons**: 36
- **Outputs**: 2
- **Activation functions**: Mixed (TANH, LOGISTIC, ReLU, IDENTITY, SELU, Swish)
- **Connectivity**: Fully connected between adjacent layers plus skip
  connections

A second topology tests a production-representative GRQ-cluster pattern with 50+
neurons and forward-only connections.

### 📊 PC vs Standard Backprop on Complex Creatures

| Metric                          | Standard Backprop | Predictive Coding | Notes                                 |
| ------------------------------- | ----------------- | ----------------- | ------------------------------------- |
| Inference converges             | N/A               | ✅ Yes            | Energy decreases monotonically        |
| Non-zero weight gradients       | ✅                | ✅                | Both methods produce updates          |
| Error decreases over iterations | ✅                | ✅                | PC matches backprop on convergence    |
| Trace tags present              | ❌                | ✅                | PC adds `approach`, `pc-energy`, etc. |

### 🔬 Key Findings for Complex Creatures

1. **Adaptive scaling is essential**: Without adaptive scaling (Issue #1915), PC
   produces no measurable improvement on 30+ neuron creatures. The default
   `energyThreshold` of `1e-6` is unreachable when 36+ error terms contribute to
   total energy, causing inference to exhaust all steps without converging.

2. **Inference converges with adaptive scaling**: With adaptive scaling, the
   energy threshold is relaxed proportionally to network size, and inference
   converges within the step budget. Energy decreases monotonically during
   settling, confirming the mathematical properties hold on complex topologies.

3. **Mixed activations work**: PC correctly handles creatures using mixed
   activation functions (TANH, LOGISTIC, ReLU, IDENTITY, SELU, Swish) across
   different layers. The derivative computation adapts per-neuron.

4. **Forward-only and recurrent topologies**: Both topology styles converge
   under PC training, though forward-only networks settle more predictably.

5. **Production-representative topologies**: The GRQ-cluster topology (50+
   neurons) demonstrates that PC with adaptive scaling produces valid trace tags
   and measurable weight changes on realistic workloads.

### ⚙️ Configuration Tuning Findings (Issue #1915)

The adaptive scaling module resolves three problems identified during complex
creature testing:

| Problem                     | Root Cause                                       | Solution                                |
| --------------------------- | ------------------------------------------------ | --------------------------------------- |
| Inference never converges   | `energyThreshold` too tight for many error terms | Scale threshold by `nonInputCount / 10` |
| Oscillation during settling | `inferenceRate` too high for large gradient sums | Scale rate by `1 / √(hiddenCount / 10)` |
| No weight changes           | `learningRate` too conservative for many params  | Scale rate by `√(hiddenCount / 10)`     |

Additionally, **gradient normalisation** (L2 norm capped at 1.0) was added to
prevent divergence in deep topologies where gradient magnitudes can explode.

> [!TIP]
> For production use with complex creatures, rely on the default PC
> configuration with adaptive scaling. Manual parameter tuning is typically
> unnecessary — the scaling module adjusts parameters based on network topology
> automatically.

---

## 🏁 Conclusions

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

6. **Adaptive scaling enables complex creatures**: Without adaptive scaling, PC
   produces no gains on networks with 30+ hidden neurons. The scaling module
   (Issue #1915) automatically adjusts `inferenceRate`, `energyThreshold`, and
   `learningRate` based on network topology, making PC effective on
   production-representative creatures with 36–50+ neurons.

7. **Mixed activations and deep topologies work**: PC with adaptive scaling and
   gradient normalisation handles mixed activation functions and multi-layer
   topologies correctly, producing monotonic energy decrease and measurable
   weight updates.

## 📖 References

- Millidge, B., Seth, A., & Buckley, C. L. (2022c). "Predictive Coding
  Approximates Backprop Along Arbitrary Computation Graphs."
- Salvatori, T., et al. (2024). "A Stable, Fast, and Fully Automatic Learning
  Algorithm for Predictive Coding Networks."

## 📚 See Also

- [PREDICTIVE_CODING.md](./PREDICTIVE_CODING.md) — parent doc; theory,
  architecture, and configuration reference for PC.
- [PERFORMANCE_RESEARCH.md](./PERFORMANCE_RESEARCH.md) — investigation log for
  the wider optimisation pipeline.
- [PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md) — operational tuning of the
  memetic loop that PC slots into.
- [BACKPROP_ELASTICITY.md](./BACKPROP_ELASTICITY.md) — elastic backpropagation,
  the standard-backprop comparison baseline used above.
- [docs/README.md](./README.md) — topic index for the full documentation set.

---

**Up to:** [`README.md`](../README.md) (entry point) ·
[`docs/README.md`](README.md) (topic index).
