# 🧵 Workers and parallel evaluation

NEAT-AI (NeuroEvolution of Augmenting Topologies — Artificial Intelligence) runs
both fitness evaluation and heavy tasks (discovery, training, recording) on a
worker pool. These options size the pool, partition it between fast and heavy
roles, and control how creatures are distributed across workers during
evaluation.

```ts
import { createNeatConfig } from "@anthropic/neat-ai";

const config = createNeatConfig({
  threads: 8,
  heavyTaskWorkerCount: 2,
  workerThreadCap: { maxMemoryMB: 8192, estimatedMemoryPerWorkerMB: 2048 },
  parallelEvaluation: { topologyGrouping: true, maxConcurrentEvaluations: 0 },
});
```

## 📊 Quick reference

| Option                                        | Type      | Default                                                          | Description                                       |
| --------------------------------------------- | --------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `threads`                                     | `integer` | `navigator.hardwareConcurrency + heavyTaskWorkerCount` (default) | Worker threads (min: 1)                           |
| `heavyTaskWorkerCount`                        | `integer` | `2`                                                              | Workers dedicated to discovery/training (min: 1)  |
| `workerThreadCap.maxMemoryMB`                 | `integer` | `0` (disabled)                                                   | Total memory budget for workers (MB)              |
| `workerThreadCap.estimatedMemoryPerWorkerMB`  | `integer` | `2048`                                                           | Estimated memory per worker (MB)                  |
| `parallelEvaluation.topologyGrouping`         | `boolean` | `true`                                                           | Group same-topology creatures for WASM cache hits |
| `parallelEvaluation.maxConcurrentEvaluations` | `integer` | `0` (all)                                                        | Max workers for evaluation                        |

## 🧮 Sizing the pool

### `threads`

**Default:** `navigator.hardwareConcurrency + heavyTaskWorkerCount` | Type:
integer | Min: 1

Total worker threads. The default keeps the fast pool at ≥ one thread per
logical CPU even after partitioning.

### Worker thread cap

Cap worker thread count based on available memory (Issue #1569). This is opt-in
— when `maxMemoryMB` is not set (or `0`), behaviour is unchanged.

```ts
const config = createNeatConfig({
  threads: 16,
  workerThreadCap: {
    maxMemoryMB: 8192, // 8 GB memory budget
    estimatedMemoryPerWorkerMB: 2048, // 2 GB per worker (default)
  },
});
// Effective threads = min(16, floor(8192 / 2048)) = 4
```

| Field                        | Default        | Min | Description                                  |
| ---------------------------- | -------------- | --- | -------------------------------------------- |
| `maxMemoryMB`                | `0` (disabled) | `0` | Total memory budget in MB for worker threads |
| `estimatedMemoryPerWorkerMB` | `2048`         | `1` | Estimated memory per worker in MB            |

When `maxMemoryMB > 0`, the effective thread count is:
`min(threads, max(1, floor(maxMemoryMB / estimatedMemoryPerWorkerMB)))`.

A warning is logged when the thread count is capped.

## ⚡ Worker pool partitioning

Issue #2243: Control how workers are split between fast tasks (fitness
evaluation/scoring) and heavy tasks (discovery, training, recording).

```ts
const config = createNeatConfig({
  threads: 8,
  heavyTaskWorkerCount: 2, // 2 heavy workers, 6 fast workers
});
```

| Field                  | Default | Min | Description                                 |
| ---------------------- | ------- | --- | ------------------------------------------- |
| `heavyTaskWorkerCount` | `2`     | `1` | Workers dedicated to discovery and training |

Fast workers (`threads - heavyTaskWorkerCount`) handle fitness evaluation
exclusively and are never blocked by long-running discovery or training tasks.

**Partitioning is disabled when `threads <= 2`** — all workers share both roles
because there are too few workers to partition meaningfully.

**Validation (when `threads > 2`):** `heavyTaskWorkerCount` must be `< threads`
so at least one worker remains available for fast tasks.

## 🚀 Parallel evaluation

Issue #1862: Controls how creatures are distributed across workers during
fitness evaluation. Topology-aware grouping ensures creatures with identical
network structure are evaluated on the same worker, maximising WASM
(WebAssembly) compilation cache hits and improving evaluation throughput.

Pass as `parallelEvaluation` in options.

```ts
const config = createNeatConfig({
  parallelEvaluation: {
    topologyGrouping: true, // default
    maxConcurrentEvaluations: 4, // cap at 4 workers for evaluation
  },
});
```

| Option                     | Type      | Default   | Description                                                     |
| -------------------------- | --------- | --------- | --------------------------------------------------------------- |
| `topologyGrouping`         | `boolean` | `true`    | Group creatures by topology hash to improve WASM cache hit rate |
| `maxConcurrentEvaluations` | `integer` | `0` (all) | Maximum workers for evaluation — 0 means use all available      |

> [!TIP]
> Keep `topologyGrouping` enabled unless you have a specific reason to disable
> it. Topology grouping improves WASM cache utilisation by batching same-shape
> creatures together. Set `maxConcurrentEvaluations` when you need to reserve
> workers for concurrent training or discovery tasks.

## ✅ Validation rules

- `threads` must be at least `1`.
- `heavyTaskWorkerCount` must be at least `1`, and strictly less than `threads`
  when `threads > 2`. Partitioning is disabled when `threads <= 2`.
- `workerThreadCap.estimatedMemoryPerWorkerMB` must be at least `1` if
  `maxMemoryMB > 0`.

## 👀 See also

- [Discovery](./DISCOVERY.md) — `maxConcurrentDiscoveries` interacts with
  `heavyTaskWorkerCount`.
- [Population sizing](./POPULATION.md) —
  `adaptivePopulation.minCreaturesPerWorker` keeps each worker fed.
- [PERFORMANCE_TUNING.md](../PERFORMANCE_TUNING.md) — operational tuning for
  WASM caches, thread pools, memory management, and scaling.
- [PERFORMANCE_RESEARCH.md](../PERFORMANCE_RESEARCH.md) — WASM migration
  research and benchmark learnings.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
