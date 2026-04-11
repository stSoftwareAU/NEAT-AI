import { assertEquals, assertThrows } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_HEAVY_TASK_WORKER_COUNT,
} from "@config/NeatConfig.ts";
import { DEFAULT_WORKER_THREAD_CAP_CONFIG } from "@config/WorkerThreadCapConfig.ts";

Deno.test("WorkerThreadCapConfig - default values are sensible", () => {
  assertEquals(DEFAULT_WORKER_THREAD_CAP_CONFIG.maxMemoryMB, 0);
  assertEquals(
    DEFAULT_WORKER_THREAD_CAP_CONFIG.estimatedMemoryPerWorkerMB,
    2048,
  );
});

Deno.test("WorkerThreadCapConfig - no capping when maxMemoryMB is not set", () => {
  const config = createNeatConfig({ threads: 8 });
  assertEquals(config.threads, 8);
  assertEquals(config.workerThreadCap.maxMemoryMB, 0);
});

Deno.test("WorkerThreadCapConfig - no capping when maxMemoryMB is 0", () => {
  const config = createNeatConfig({
    threads: 8,
    workerThreadCap: { maxMemoryMB: 0 },
  });
  assertEquals(config.threads, 8);
});

Deno.test("WorkerThreadCapConfig - caps threads based on memory budget", () => {
  // 8192 MB / 2048 MB per worker = 4 workers max
  const config = createNeatConfig({
    threads: 16,
    workerThreadCap: { maxMemoryMB: 8192 },
  });
  assertEquals(config.threads, 4);
});

Deno.test("WorkerThreadCapConfig - caps with custom estimatedMemoryPerWorkerMB", () => {
  // 4096 MB / 1024 MB per worker = 4 workers max
  const config = createNeatConfig({
    threads: 10,
    workerThreadCap: {
      maxMemoryMB: 4096,
      estimatedMemoryPerWorkerMB: 1024,
    },
  });
  assertEquals(config.threads, 4);
});

Deno.test("WorkerThreadCapConfig - no capping when threads already within budget", () => {
  // 16384 MB / 2048 MB per worker = 8 workers max, but we only want 4
  const config = createNeatConfig({
    threads: 4,
    workerThreadCap: { maxMemoryMB: 16384 },
  });
  assertEquals(config.threads, 4);
});

Deno.test("WorkerThreadCapConfig - minimum 1 thread even with tiny memory budget", () => {
  // 100 MB / 2048 MB per worker = 0.048... → floor = 0, but minimum is 1
  const config = createNeatConfig({
    threads: 8,
    workerThreadCap: { maxMemoryMB: 100 },
  });
  assertEquals(config.threads, 1);
});

Deno.test("WorkerThreadCapConfig - exact division results in correct cap", () => {
  // 6144 MB / 2048 MB per worker = exactly 3
  const config = createNeatConfig({
    threads: 8,
    workerThreadCap: { maxMemoryMB: 6144 },
  });
  assertEquals(config.threads, 3);
});

Deno.test("WorkerThreadCapConfig - non-exact division floors correctly", () => {
  // 5000 MB / 2048 MB per worker = 2.44... → floor = 2
  const config = createNeatConfig({
    threads: 8,
    workerThreadCap: { maxMemoryMB: 5000 },
  });
  assertEquals(config.threads, 2);
});

Deno.test("WorkerThreadCapConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    workerThreadCap: { maxMemoryMB: 8192 },
  });
  assertEquals(config.workerThreadCap.maxMemoryMB, 8192);
  assertEquals(
    config.workerThreadCap.estimatedMemoryPerWorkerMB,
    DEFAULT_WORKER_THREAD_CAP_CONFIG.estimatedMemoryPerWorkerMB,
  );
});

Deno.test("WorkerThreadCapConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    workerThreadCap: {
      maxMemoryMB: 4096,
      estimatedMemoryPerWorkerMB: 512,
    },
  });
  assertEquals(config.workerThreadCap.maxMemoryMB, 4096);
  assertEquals(config.workerThreadCap.estimatedMemoryPerWorkerMB, 512);
});

Deno.test("WorkerThreadCapConfig - string values coerced from CLI", () => {
  const config = createNeatConfig({
    threads: 16,
    workerThreadCap: {
      maxMemoryMB: "8192" as unknown as number,
      estimatedMemoryPerWorkerMB: "2048" as unknown as number,
    },
  });
  assertEquals(config.workerThreadCap.maxMemoryMB, 8192);
  assertEquals(config.workerThreadCap.estimatedMemoryPerWorkerMB, 2048);
  assertEquals(config.threads, 4);
});

Deno.test("WorkerThreadCapConfig - estimatedMemoryPerWorkerMB must be >= 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        workerThreadCap: { estimatedMemoryPerWorkerMB: 0 },
      }),
    Error,
    "estimatedMemoryPerWorkerMB",
  );
});

Deno.test("WorkerThreadCapConfig - maxMemoryMB must be >= 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        workerThreadCap: { maxMemoryMB: -1 },
      }),
    Error,
    "maxMemoryMB",
  );
});

Deno.test("WorkerThreadCapConfig - backwards compatible when not set", () => {
  const config = createNeatConfig({});
  assertEquals(config.workerThreadCap.maxMemoryMB, 0);
  assertEquals(config.workerThreadCap.estimatedMemoryPerWorkerMB, 2048);
  // threads default = cores + heavy partition so fast pool saturates CPUs
  const expected = Math.max(1, navigator.hardwareConcurrency ?? 1) +
    DEFAULT_HEAVY_TASK_WORKER_COUNT;
  assertEquals(config.threads, expected);
});

Deno.test("WorkerThreadCapConfig - config rejects property assignment after creation", () => {
  const config = createNeatConfig({
    workerThreadCap: { maxMemoryMB: 8192 },
  });
  assertThrows(
    () => {
      (config as Record<string, unknown>).workerThreadCap = {};
    },
    TypeError,
    "Cannot assign",
  );
});
