# 🍳 Recipes

Working examples that combine multiple configuration domains. Each recipe is a
starting point — adjust the values to your dataset and compute budget.

## ⚡ Fast prototyping

Small population, quick iterations to validate an approach:

```ts
import { createNeatConfig } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  populationSize: 10,
  iterations: 50,
  targetError: 0.1,
  trainPerGen: 1,
  discoverySampleRate: -1, // Disable discovery for speed
  timeoutMinutes: 5,
});
```

See [PRESETS.md](./PRESETS.md) for the equivalent `QUICK_START_PRESET`.

## 🏭 Production training

Large population with discovery enabled for thorough structural optimisation:

```ts
const config = createNeatConfig({
  populationSize: 200,
  iterations: 10_000,
  targetError: 0.01,
  trainPerGen: 2,
  discoverySampleRate: 0.3,
  discoveryRecordTimeOutMinutes: 10,
  discoveryAnalysisTimeoutMinutes: 20,
  timeoutMinutes: 120,
  discoveryCacheDir: "./discovery-cache",
  plateauDetection: {
    enabled: true,
    windowSize: 15,
    responseMutationMultiplier: 2.5,
  },
  stabilityAdaptation: {
    enabled: true,
  },
});
```

## 🔬 Research / reproducibility

Seeded PRNG (Pseudo-Random Number Generator) for deterministic, reproducible
experiments:

```ts
const config = createNeatConfig({
  seed: 42,
  populationSize: 50,
  iterations: 1_000,
  targetError: 0.05,
  // Fixed values instead of random defaults
  sparseRatio: 0.5,
  globalBreedingRate: 0.5,
});
```

See [LOGGING.md](./LOGGING.md) for the full reproducibility checklist.

## 🔁 Time-series / recurrent

Enable feedback loops for sequential data:

```ts
const config = createNeatConfig({
  feedbackLoop: true,
  disableRandomSamples: true, // Required when feedbackLoop is true
  populationSize: 50,
  iterations: 500,
  targetError: 0.05,
});
```

## 🪶 Minimal complexity

Favour simpler networks with aggressive growth penalties:

```ts
const config = createNeatConfig({
  costOfGrowth: 0.001,
  maxConns: 50,
  maximumNumberOfNodes: 20,
  populationSize: 50,
  targetError: 0.05,
});
```

## 🛡️ Maximum generalisation

Combine noise injection and cross-validation to fight overfitting:

```ts
const config = createNeatConfig({
  populationSize: 100,
  iterations: 5_000,
  targetError: 0.02,
  dataFuzzing: {
    enabled: true,
    inputNoiseScale: 0.02,
    noiseType: "gaussian",
  },
  crossValidation: {
    enabled: true,
    folds: 5,
  },
});
```

## 🧬 Self-tuning evolution

Let hyperparameters and population size evolve alongside the creatures:

```ts
const config = createNeatConfig({
  populationSize: 100,
  iterations: 10_000,
  targetError: 0.01,
  hyperparameterEvolution: {
    enabled: true,
  },
  adaptivePopulation: {
    enabled: true,
    lowDiversityThreshold: 0.3,
    highDiversityThreshold: 0.8,
    minCreaturesPerWorker: 3, // ensure enough work per worker
  },
});
```

## 👀 See also

- [PRESETS.md](./PRESETS.md) — pre-built profiles that cover most of these
  scenarios.
- [CORE_EVOLUTION.md](./CORE_EVOLUTION.md), [TRAINING.md](./TRAINING.md),
  [DISCOVERY.md](./DISCOVERY.md) — per-domain detail.
- [PERFORMANCE_TUNING.md](../PERFORMANCE_TUNING.md) — operational guidance for
  picking thread counts, batch sizes, and memory budgets.
- [PERFORMANCE_RESEARCH.md](../PERFORMANCE_RESEARCH.md) — benchmark learnings
  behind these defaults.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
