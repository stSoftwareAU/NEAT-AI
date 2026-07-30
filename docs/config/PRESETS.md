# 🚀 Configuration Presets

NEAT-AI (NeuroEvolution of Augmenting Topologies — Artificial Intelligence)
ships pre-built configuration presets for common training scenarios. Each preset
is a `NeatOptions` object that can be spread into your configuration — user
overrides take precedence when spread after the preset.

```ts
import { createNeatConfig, QUICK_START_PRESET } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  ...QUICK_START_PRESET,
  populationSize: 25, // override the preset value
});
```

## 📊 Available presets

| Preset                      | Population | Discovery | Timeout | Use case                                     |
| --------------------------- | ---------- | --------- | ------- | -------------------------------------------- |
| `QUICK_START_PRESET`        | 10         | Disabled  | 5 min   | Learning, prototyping, quick experiments     |
| `LARGE_NETWORK_PRESET`      | 200        | 30%       | 2 hrs   | Complex problems with many inputs/outputs    |
| `MEMORY_CONSTRAINED_PRESET` | 20         | Disabled  | 30 min  | Limited-memory environments, CI/CD runners   |
| `DISCOVERY_FOCUSED_PRESET`  | 100        | 50%       | 3 hrs   | Finding novel architectures, research        |
| `FAST_CONVERGENCE_PRESET`   | 50         | 20%       | 30 min  | Reaching a target error in fewer generations |

### ⚡ Quick Start

Small population, fast iterations, good for learning and prototyping. Discovery
is disabled for speed.

```ts
import { createNeatConfig, QUICK_START_PRESET } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  ...QUICK_START_PRESET,
  targetError: 0.05,
});
```

**Settings:** `populationSize: 10`, `iterations: 100`, `targetError: 0.1`,
`discoverySampleRate: -1`, `timeoutMinutes: 5`.

### 🔬 Large Network

Higher population with discovery, plateau detection, and stability adaptation
enabled. Suitable for complex problems requiring larger architectures.

```ts
import { createNeatConfig, LARGE_NETWORK_PRESET } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  ...LARGE_NETWORK_PRESET,
  discoveryCacheDir: "./discovery-cache",
});
```

**Settings:** `populationSize: 200`, `iterations: 10_000`, `targetError: 0.01`,
`discoverySampleRate: 0.3`, `timeoutMinutes: 120`, plateau detection enabled,
stability adaptation enabled.

### 💾 Memory Constrained

Conservative resource usage for limited-memory environments. Uses fewer threads,
smaller populations, and disables discovery.

```ts
import {
  createNeatConfig,
  MEMORY_CONSTRAINED_PRESET,
} from "@stsoftware/neat-ai";

const config = createNeatConfig({
  ...MEMORY_CONSTRAINED_PRESET,
});
```

**Settings:** `populationSize: 20`, `threads: 2`, `trainingBatchSize: 50`,
`discoverySampleRate: -1`, `timeoutMinutes: 30`.

### 🔭 Discovery Focused

Aggressive structural evolution with higher sample rates, more neurons analysed
per iteration, and longer timeouts. Suitable for finding novel architectures.

```ts
import {
  createNeatConfig,
  DISCOVERY_FOCUSED_PRESET,
} from "@stsoftware/neat-ai";

const config = createNeatConfig({
  ...DISCOVERY_FOCUSED_PRESET,
  discoveryCacheDir: "./discovery-cache",
});
```

**Settings:** `populationSize: 100`, `discoverySampleRate: 0.5`,
`discoveryMaxNeurons: 12`, `costOfGrowth: 0.00000001`, `timeoutMinutes: 180`,
plateau detection enabled.

### 🏁 Fast Convergence

Bundles the high-impact "pace" levers that ship fully implemented but **off by
default**, so reaching `targetError` takes fewer generations. A one-line opt-in
to "evolve faster".

```ts
import { createNeatConfig, FAST_CONVERGENCE_PRESET } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  ...FAST_CONVERGENCE_PRESET,
  targetError: 0.02, // override for a tighter target
});
```

**Settings:** `populationSize: 50`, `elitism: 2`, `timeoutMinutes: 30`, plateau
detection enabled with a 2× stall mutation boost (`windowSize: 10`,
`responseMutationMultiplier: 2.0`), adaptive population sizing enabled, and
species stagnation tightened (`haltWindow: 12`, `extinctionWindow: 20`).
`trainPerGen` is deliberately left unset so the supervised auto-scaling applies
(`round(populationSize × 0.2)` — 10 for this population); pinning a small
literal would starve gradient descent and slow convergence.
`discoverySampleRate` is also left unset, so discovery stays at the default 20%
(`DEFAULT_DISCOVERY_SAMPLE_RATE`); structural discovery is **enabled** for this
preset and can help reach the target in fewer generations — it is not disabled
for raw speed the way `QUICK_START_PRESET` and `MEMORY_CONSTRAINED_PRESET` are.

> [!NOTE]
> **Trade-offs.** Higher per-generation cost (adaptive sizing can grow the
> population; the auto-scaled `trainPerGen` runs more backprop passes; discovery
> stays at the default 20%, so the Rust FFI structural-analysis phase runs) and
> a little more premature-convergence risk from the higher elitism and
> aggressive plateau response. Plateau detection's 2× boost and per-species
> stagnation reclamation are the diversity counter-weights.
>
> **When NOT to use it.** On trivially easy tasks (e.g. 2-input XOR) the
> defaults already converge in a handful of generations and the extra
> exploration just adds variance. The preset earns its keep on harder,
> plateau-prone problems — the bundled `bench/FastConvergencePreset.ts` shows it
> converging on a 3-bit parity task in ~10% fewer generations on average,
> solving seeds the defaults stall on within the same budget.

### 🔀 Composing presets

Presets can be composed by spreading multiple presets or mixing with custom
overrides. Later values take precedence:

```ts
import {
  createNeatConfig,
  DISCOVERY_FOCUSED_PRESET,
  MEMORY_CONSTRAINED_PRESET,
} from "@stsoftware/neat-ai";

// Start with memory constraints, then override with discovery settings
// but keep limited threads.
const config = createNeatConfig({
  ...MEMORY_CONSTRAINED_PRESET,
  ...DISCOVERY_FOCUSED_PRESET,
  threads: 2, // keep limited threads
});
```

## 👀 See also

- [Core evolution parameters](./CORE_EVOLUTION.md) — what each preset overrides.
- [Discovery parameters](./DISCOVERY.md) — discovery sample rate, timeouts, and
  caching.
- [PERFORMANCE_TUNING.md](../PERFORMANCE_TUNING.md) — operational guide for
  picking thread counts, batch sizes, and memory budgets.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
