/**
 * Factory for the {@link MemoryPressureSink} the evolution loop hands to
 * `checkMemoryAndEvict` (Issue #3431).
 *
 * The MemoryMonitor evicts main-thread WASM caches and process-global
 * breed/discovery indexes on its own, but worker isolates keep their own WASM
 * heaps that only the owning `Neat` instance can address. This factory adapts a
 * pool of {@link WorkerHandler}s into a sink so a WARNING/CRITICAL response also
 * reduces worker cache caps, and so diagnostics can report how many worker
 * isolates are live.
 */

import type { WasmCacheConfig } from "@config/WasmCacheConfig.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { MemoryPressureSink } from "@neat/MemoryMonitor.ts";

/**
 * Build a {@link MemoryPressureSink} that broadcasts reduced WASM cache caps to
 * every supplied worker and reports the live worker count.
 *
 * The broadcast is fire-and-forget: `configureCache` returns a promise that is
 * intentionally not awaited (the memory response must stay synchronous), and
 * any rejection — e.g. a worker that has already terminated — is swallowed so a
 * dead worker can never crash the memory monitor. Per-worker delivery is
 * isolated in a try/catch so one throwing handler does not skip the rest.
 *
 * @param workers - Live worker handlers (typically `neat.workers`).
 */
export function createMemoryPressureSink(
  workers: readonly WorkerHandler[],
): MemoryPressureSink {
  return {
    configureWorkerCaches(config: WasmCacheConfig): void {
      for (const worker of workers) {
        try {
          const pending = worker.configureCache(config);
          // Fire-and-forget: never let a rejected worker promise surface as an
          // unhandled rejection or block the synchronous eviction path.
          void Promise.resolve(pending).catch(() => {});
        } catch {
          // A dead/terminated worker must not abort the broadcast to the rest.
        }
      }
    },
    workerCount(): number {
      return workers.length;
    },
  };
}
