import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_HEAVY_TASK_WORKER_COUNT,
} from "@config/NeatConfig.ts";
import { DEFAULT_WORKER_THREAD_CAP_CONFIG } from "@config/WorkerThreadCapConfig.ts";
import {
  DISCOVERY_PER_WORKER_HEAP_CAP_ENV,
  DISCOVERY_WORKER_ENVELOPE_ENV,
} from "@config/DiscoveryWorkerEnvelope.ts";
import { DISCOVERY_HEAP_SIZE_ENV } from "@workers/WorkerHeapBudget.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/** Env vars the Discovery envelope wiring reads (GRQ#3295). */
const ENVELOPE_ENV_KEYS = [
  DISCOVERY_WORKER_ENVELOPE_ENV,
  DISCOVERY_HEAP_SIZE_ENV,
  DISCOVERY_PER_WORKER_HEAP_CAP_ENV,
];

/**
 * Run `fn` with the given envelope env vars set, restoring the prior process
 * environment afterwards. Tests within a file run sequentially and each file
 * runs in its own process under `deno test --parallel`, so the set/restore
 * window cannot race another test.
 */
function withEnvelopeEnv(
  overrides: Record<string, string>,
  fn: () => void,
): void {
  const prior = new Map<string, string | undefined>();
  for (const key of ENVELOPE_ENV_KEYS) {
    prior.set(key, Deno.env.get(key));
    Deno.env.delete(key);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      Deno.env.set(key, value);
    }
    fn();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

/** Logger that records emitted lines by level for assertions. */
function makeRecordingLogger(): {
  logger: Logger;
  lines: { level: string; message: string }[];
} {
  const lines: { level: string; message: string }[] = [];
  const logger: Logger = {
    debug: (...a) => lines.push({ level: "debug", message: a.join(" ") }),
    info: (...a) => lines.push({ level: "info", message: a.join(" ") }),
    warn: (...a) => lines.push({ level: "warn", message: a.join(" ") }),
    error: (...a) => lines.push({ level: "error", message: a.join(" ") }),
  };
  return { logger, lines };
}

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

Deno.test("worker thread cap — GRQ-22 envelope", () => {
  // GRQ-22 signature: available 7840 MB, 10 cores → 12 default threads, each
  // worker isolate carries the process --max-old-space-size=4096. Without the
  // cap this over-commits 12 × 4096 ≈ 48 GB on a 16 GB host and OOM-kills.
  const { logger, lines } = makeRecordingLogger();
  // The cap-fired warning is emitted through the global getLogger() before
  // createNeatConfig installs its own logger, so install the recorder globally
  // to capture it (restored afterwards).
  const priorLogger = getLogger();
  setLogger(logger);
  withEnvelopeEnv(
    {
      [DISCOVERY_WORKER_ENVELOPE_ENV]: "7840",
      [DISCOVERY_HEAP_SIZE_ENV]: "4096",
    },
    () => {
      const config = createNeatConfig({ logger });

      // Cap wired automatically from env — no opt-in needed.
      assertEquals(config.workerThreadCap.maxMemoryMB, 7840);
      assertEquals(config.workerThreadCap.estimatedMemoryPerWorkerMB, 4096);

      // Core invariant: aggregate worker heap fits the envelope (and available).
      const aggregate = config.threads *
        config.workerThreadCap.estimatedMemoryPerWorkerMB;
      assert(
        aggregate <= config.workerThreadCap.maxMemoryMB,
        `aggregate ${aggregate} must be <= envelope ${config.workerThreadCap.maxMemoryMB}`,
      );
      assert(
        aggregate <= 7840,
        `aggregate ${aggregate} must be <= available 7840`,
      );

      // floor(7840 / 4096) = 1, far below the ≥3 default (min 1 core + 2).
      assertEquals(config.threads, 1);

      // The cap-fired warning records the host-derived numbers.
      const warn = lines.find((l) =>
        l.level === "warn" && l.message.includes("capped")
      );
      assert(warn, "expected a worker-thread-cap warning");
      assert(
        warn!.message.includes("maxMemoryMB: 7840"),
        `warn should record host maxMemoryMB: ${warn!.message}`,
      );
      assert(
        warn!.message.includes("estimatedMemoryPerWorkerMB: 4096"),
        `warn should record host estimatedMemoryPerWorkerMB: ${warn!.message}`,
      );
    },
  );
  setLogger(priorLogger);
});

Deno.test("worker thread cap — disabled when Discovery envelope env unset", () => {
  // Non-Discovery callers: env absent → behaviour unchanged, cap stays disabled.
  withEnvelopeEnv({}, () => {
    const config = createNeatConfig({});
    assertEquals(config.workerThreadCap.maxMemoryMB, 0);
    assertEquals(config.workerThreadCap.estimatedMemoryPerWorkerMB, 2048);
    const expected = Math.max(1, navigator.hardwareConcurrency ?? 1) +
      DEFAULT_HEAVY_TASK_WORKER_COUNT;
    assertEquals(config.threads, expected);
  });
});

Deno.test("worker thread cap — explicit user override wins over envelope env", () => {
  // A caller that sets maxMemoryMB explicitly keeps control; the envelope only
  // supplies the per-worker estimate it did not provide.
  withEnvelopeEnv(
    {
      [DISCOVERY_WORKER_ENVELOPE_ENV]: "7840",
      [DISCOVERY_HEAP_SIZE_ENV]: "4096",
    },
    () => {
      const config = createNeatConfig({
        workerThreadCap: { maxMemoryMB: 16384 },
      });
      assertEquals(config.workerThreadCap.maxMemoryMB, 16384);
      // Per-worker estimate still comes from the host envelope (4096).
      assertEquals(config.workerThreadCap.estimatedMemoryPerWorkerMB, 4096);
    },
  );
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
