# 🧵 Compute, WASM, and Multithreading

Worker entry points, WASM (WebAssembly) preloading, and cache diagnostics for
the compute layer that powers `Creature.activate()`.

> **Acronyms:** API (Application Programming Interface), WASM (WebAssembly), JSR
> (JavaScript Registry), LRU (Least Recently Used), GC (Garbage Collection).

## 📦 Exports documented here

- `fetchWasmForWorkers`, `loadWasmActivationInitPayloadAsync`,
  `WasmActivationInitPayload`, `initialiseWasmActivationFromPayload`
- `disposeAllCachedWasmActivations`, `getCachedWasmActivationCount`,
  `getMaxCachedWasmCreatureActivations`, `setMaxCachedWasmCreatureActivations`,
  `getWasmActivationLruStats`, `resetWasmActivationLruStats`
- `CacheStats`, `getCacheStats`

## ⚡ WASM preloading for workers

Issue #1285 / Issue #2545: call `fetchWasmForWorkers()` in the main thread
before spawning workers so WASM is fetched once and cached. Workers then receive
the cached payload instead of each fetching separately.

```typescript
import { fetchWasmForWorkers } from "@stsoftware/neat-ai";

// Main thread — call once before evolveDir() with threads > 1
await fetchWasmForWorkers();
```

> [!TIP]
> Call `fetchWasmForWorkers()` once before `evolveDir()` whenever `threads > 1`.
> This avoids each worker independently fetching and compiling the WASM binary,
> which can significantly reduce startup time in large-population runs.

### Consumer-owned worker bootstrap

For _consumer-owned_ Deno workers that import NEAT-AI from JSR (JavaScript
Registry) and may not have `--allow-net` to `jsr.io` inside the worker scope:

1. Fetch the payload with `loadWasmActivationInitPayloadAsync()` in the parent
   thread.
2. Send the resulting bytes to the worker via `postMessage`.
3. Inside the worker, bootstrap WASM by calling
   `initialiseWasmActivationFromPayload(payload)`.

```typescript
import {
  initialiseWasmActivationFromPayload,
  loadWasmActivationInitPayloadAsync,
} from "@stsoftware/neat-ai";
import type { WasmActivationInitPayload } from "@stsoftware/neat-ai";

// Parent
const payload: WasmActivationInitPayload =
  await loadWasmActivationInitPayloadAsync();
worker.postMessage({ type: "wasm-payload", payload });

// Worker
worker.addEventListener("message", (event) => {
  if (event.data.type === "wasm-payload") {
    initialiseWasmActivationFromPayload(event.data.payload);
  }
});
```

See [`docs/troubleshooting/WASM.md`](../troubleshooting/WASM.md) for the full
pattern.

## 🔀 Using multiple threads

Workers are managed automatically by `Creature.evolveDir()` when `threads > 1`:

```typescript
const result = await creature.evolveDir("./data", {
  threads: 4, // Use 4 worker threads
  costName: "MSE",
  iterations: 100,
});
```

Workers handle evaluation, training, discovery, and breeding in parallel. If a
worker fails to initialise (e.g. in restricted environments), it falls back to
direct (in-process) execution automatically.

## 🗃️ WASM cache control

Issues #1338, #1504, #1581: Control the WASM activation LRU (Least Recently
Used) cache size, query occupancy, and flush all cached entries. Data-generation
workloads that touch many creatures should lower the cache cap (e.g. 64–128) to
reduce WASM heap retention, and call `disposeAllCachedWasmActivations()` between
training runs to fully free WASM linear memory.

```typescript
import {
  disposeAllCachedWasmActivations,
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  getWasmActivationLruStats,
  resetWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "@stsoftware/neat-ai";

// Check current cache usage
const count = getCachedWasmActivationCount();

// Get the maximum cache size (default: 512)
const max = getMaxCachedWasmCreatureActivations();

// Reduce cache size if memory is tight
setMaxCachedWasmCreatureActivations(256);

// Inspect hit / miss / eviction counters
const stats = getWasmActivationLruStats();
resetWasmActivationLruStats();

// Free all WASM linear memory between runs
disposeAllCachedWasmActivations();
```

## 📊 Unified cache diagnostics

Issue #1616: `getCacheStats()` returns hit/miss rates, eviction counts, and size
metrics for every instrumented cache (WASM activation cache, distance cache,
etc.). Use these metrics to tune cache configuration for your workload.

```typescript
import { getCacheStats } from "@stsoftware/neat-ai";
import type { CacheStats } from "@stsoftware/neat-ai";

const stats: CacheStats = getCacheStats();
console.log(stats);
```

---

## 🔗 Related topics

- [Configuration reference](CONFIGURATION.md) — `threads` and
  `parallelEvaluation` sub-config control how workers are spawned.
- [Discovery](DISCOVERY.md) — discovery analysis runs through workers when
  `threads > 1`.
- [Creature](CREATURE.md) — `Creature.activate()` is the consumer of the WASM
  activation cache.
- [`docs/GPU_ACCELERATION.md`](../GPU_ACCELERATION.md) — GPU compute details.
- [`docs/PERFORMANCE_TUNING.md`](../PERFORMANCE_TUNING.md) — operational tuning.
- [`docs/troubleshooting/WASM.md`](../troubleshooting/WASM.md) — worker-init
  failure modes.
