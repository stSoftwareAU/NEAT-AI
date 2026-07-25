import { assertEquals } from "@std/assert";
import { createMemoryPressureSink } from "@neat/createMemoryPressureSink.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { WasmCacheConfig } from "@config/WasmCacheConfig.ts";

/**
 * Minimal fake WorkerHandler capturing configureCache calls. Issue #3431.
 * Only the members the sink touches are implemented.
 */
function fakeWorker(behaviour: "resolve" | "reject" | "throw" = "resolve") {
  const calls: WasmCacheConfig[] = [];
  const handler = {
    calls,
    configureCache(config: WasmCacheConfig) {
      calls.push(config);
      if (behaviour === "throw") throw new Error("worker dead");
      if (behaviour === "reject") return Promise.reject(new Error("gone"));
      return Promise.resolve({ configureCache: { status: "OK" } });
    },
  };
  return handler as unknown as WorkerHandler & { calls: WasmCacheConfig[] };
}

Deno.test("createMemoryPressureSink broadcasts caps to every worker (#3431)", () => {
  const a = fakeWorker();
  const b = fakeWorker();
  const sink = createMemoryPressureSink([a, b]);

  sink.configureWorkerCaches?.({
    maxCachedActivations: 1,
    compilationCacheSize: 1,
  });

  assertEquals(a.calls.length, 1);
  assertEquals(b.calls.length, 1);
  assertEquals(a.calls[0].maxCachedActivations, 1);
  assertEquals(b.calls[0].compilationCacheSize, 1);
});

Deno.test("createMemoryPressureSink reports the live worker count (#3431)", () => {
  const sink = createMemoryPressureSink([
    fakeWorker(),
    fakeWorker(),
    fakeWorker(),
  ]);
  assertEquals(sink.workerCount?.(), 3);
});

Deno.test("createMemoryPressureSink is a no-op broadcast for an empty pool (#3431)", () => {
  const sink = createMemoryPressureSink([]);
  // Must not throw with no workers.
  sink.configureWorkerCaches?.({ maxCachedActivations: 2 });
  assertEquals(sink.workerCount?.(), 0);
});

Deno.test(
  "createMemoryPressureSink continues past a throwing worker (#3431)",
  () => {
    const dead = fakeWorker("throw");
    const alive = fakeWorker();
    const sink = createMemoryPressureSink([dead, alive]);

    // The throwing worker must not prevent delivery to the healthy one.
    sink.configureWorkerCaches?.({ maxCachedActivations: 1 });

    assertEquals(dead.calls.length, 1);
    assertEquals(alive.calls.length, 1);
  },
);

Deno.test(
  "createMemoryPressureSink swallows a rejected worker promise (#3431)",
  async () => {
    const rejecting = fakeWorker("reject");
    const sink = createMemoryPressureSink([rejecting]);

    // A rejected configureCache promise must not surface as an unhandled
    // rejection. Broadcasting must return synchronously without throwing.
    sink.configureWorkerCaches?.({ maxCachedActivations: 1 });
    assertEquals(rejecting.calls.length, 1);

    // Give the microtask queue a turn so the swallowed rejection settles.
    await Promise.resolve();
  },
);
