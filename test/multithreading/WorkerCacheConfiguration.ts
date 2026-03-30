/**
 * Issue #1567: Verify that WASM cache limits can be propagated to worker threads.
 *
 * Tests the configure-cache and request-cache-stats message protocol that
 * allows the main thread to:
 * 1. Set WASM cache caps in workers during initialisation
 * 2. Dynamically reduce worker cache caps via message passing
 * 3. Request cache statistics from workers
 */
import { assertEquals, assertExists } from "@std/assert";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import { WorkerProcessor } from "@multithreading/workers/WorkerProcessor.ts";

Deno.test("configure-cache RequestData is structured-clone safe", () => {
  const data: RequestData = {
    taskID: 1,
    configureCache: {
      maxCachedActivations: 256,
      compilationCacheSize: 50,
    },
  };

  const cloned = structuredClone(data);
  assertExists(
    cloned.configureCache,
    "cloned data should have configureCache field",
  );
  assertEquals(
    cloned.configureCache.maxCachedActivations,
    256,
    "maxCachedActivations should survive clone",
  );
  assertEquals(
    cloned.configureCache.compilationCacheSize,
    50,
    "compilationCacheSize should survive clone",
  );
});

Deno.test("request-cache-stats RequestData is structured-clone safe", () => {
  const data: RequestData = {
    taskID: 2,
    requestCacheStats: true,
  };

  const cloned = structuredClone(data);
  assertEquals(
    cloned.requestCacheStats,
    true,
    "requestCacheStats should survive clone",
  );
});

Deno.test("WorkerProcessor handles configure-cache message", async () => {
  const processor = new WorkerProcessor();

  const response: ResponseData = await processor.process({
    taskID: 42,
    configureCache: {
      maxCachedActivations: 128,
      compilationCacheSize: 25,
    },
  });

  assertEquals(response.taskID, 42, "taskID should match");
  assertExists(
    response.configureCache,
    "response should have configureCache field",
  );
  assertEquals(
    response.configureCache.status,
    "OK",
    "configure-cache should succeed",
  );
});

Deno.test("WorkerProcessor handles request-cache-stats message", async () => {
  const processor = new WorkerProcessor();

  const response: ResponseData = await processor.process({
    taskID: 43,
    requestCacheStats: true,
  });

  assertEquals(response.taskID, 43, "taskID should match");
  assertExists(
    response.cacheStats,
    "response should have cacheStats field",
  );

  // Verify stats structure
  const stats = response.cacheStats;
  assertEquals(
    typeof stats.activationCacheCount,
    "number",
    "activationCacheCount should be a number",
  );
  assertEquals(
    typeof stats.activationCacheMax,
    "number",
    "activationCacheMax should be a number",
  );
  assertEquals(
    typeof stats.compilationCacheSize,
    "number",
    "compilationCacheSize should be a number",
  );
  assertEquals(
    typeof stats.compilationCacheMax,
    "number",
    "compilationCacheMax should be a number",
  );
});

Deno.test("WorkerProcessor configure-cache updates cache limits", async () => {
  const processor = new WorkerProcessor();

  // Set new cache limits
  await processor.process({
    taskID: 1,
    configureCache: {
      maxCachedActivations: 64,
      compilationCacheSize: 10,
    },
  });

  // Request stats to verify limits were applied
  const statsResponse = await processor.process({
    taskID: 2,
    requestCacheStats: true,
  });

  assertExists(statsResponse.cacheStats, "should have cacheStats");
  assertEquals(
    statsResponse.cacheStats.activationCacheMax,
    64,
    "activation cache max should reflect configured value",
  );
  assertEquals(
    statsResponse.cacheStats.compilationCacheMax,
    10,
    "compilation cache max should reflect configured value",
  );
});

Deno.test("WorkerProcessor configure-cache with partial config", async () => {
  const processor = new WorkerProcessor();

  // Only set activation cache limit
  const response = await processor.process({
    taskID: 1,
    configureCache: {
      maxCachedActivations: 200,
    },
  });

  assertEquals(
    response.configureCache?.status,
    "OK",
    "partial configure-cache should succeed",
  );
});

Deno.test("initialise RequestData with wasmCache is structured-clone safe", () => {
  const data: RequestData = {
    taskID: 1,
    initialize: {
      dataSetDir: "/tmp/test",
      costName: "MSE",
      wasmCache: {
        maxCachedActivations: 300,
        compilationCacheSize: 75,
      },
    },
  };

  const cloned = structuredClone(data);
  assertExists(cloned.initialize?.wasmCache, "wasmCache should survive clone");
  assertEquals(
    cloned.initialize!.wasmCache!.maxCachedActivations,
    300,
  );
  assertEquals(
    cloned.initialize!.wasmCache!.compilationCacheSize,
    75,
  );
});
