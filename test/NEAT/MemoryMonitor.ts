import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  applyCriticalResponse,
  applyWarningResponse,
  attemptProactiveGc,
  captureMemorySnapshot,
  checkMemoryAndEvict,
  determinePressureLevel,
  formatMemorySnapshot,
  logMemoryUsage,
  type MemoryCheckResult,
  type MemorySnapshot,
  type MemoryUsageProvider,
  resetMemoryPressureLogCountersForTests,
} from "@neat/MemoryMonitor.ts";
import {
  DEFAULT_MEMORY_CONFIG,
  type RequiredMemoryConfig,
} from "@config/MemoryConfig.ts";
import {
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";
import {
  getWasmCompilationCacheMaxSize,
  setWasmCompilationCacheSize,
} from "@wasm/WasmCompilationCache.ts";
import type { Logger } from "@utils/Logger.ts";

/** Silent logger that captures messages for assertions. */
function createTestLogger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    debug(...args: unknown[]) {
      messages.push(args.map(String).join(" "));
    },
    info(...args: unknown[]) {
      messages.push(args.map(String).join(" "));
    },
    warn(...args: unknown[]) {
      messages.push(args.map(String).join(" "));
    },
    error(...args: unknown[]) {
      messages.push(args.map(String).join(" "));
    },
  };
}

/** Create a fake memory provider returning the given usage fraction. */
function fakeMemoryProvider(
  heapUsed: number,
  heapTotal: number,
  extras: { rss?: number; external?: number; arrayBuffers?: number } = {},
): MemoryUsageProvider {
  return () => ({ heapUsed, heapTotal, ...extras });
}

/** Create a mutable fake clock. */
function fakeClock(startMs = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

Deno.test("determinePressureLevel returns normal below warning threshold", () => {
  const level = determinePressureLevel(0.5, DEFAULT_MEMORY_CONFIG);
  assertStrictEquals(level, "normal");
});

Deno.test("determinePressureLevel returns warning at warning threshold", () => {
  const level = determinePressureLevel(0.70, DEFAULT_MEMORY_CONFIG);
  assertStrictEquals(level, "warning");
});

Deno.test("determinePressureLevel returns warning between warning and critical", () => {
  const level = determinePressureLevel(0.80, DEFAULT_MEMORY_CONFIG);
  assertStrictEquals(level, "warning");
});

Deno.test("determinePressureLevel returns critical at critical threshold", () => {
  const level = determinePressureLevel(0.85, DEFAULT_MEMORY_CONFIG);
  assertStrictEquals(level, "critical");
});

Deno.test("determinePressureLevel returns critical above critical threshold", () => {
  const level = determinePressureLevel(0.95, DEFAULT_MEMORY_CONFIG);
  assertStrictEquals(level, "critical");
});

Deno.test("determinePressureLevel uses custom thresholds", () => {
  const config: RequiredMemoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    enabled: true,
    warningThreshold: 0.50,
    criticalThreshold: 0.60,
  };
  assertStrictEquals(determinePressureLevel(0.45, config), "normal");
  assertStrictEquals(determinePressureLevel(0.55, config), "warning");
  assertStrictEquals(determinePressureLevel(0.65, config), "critical");
});

Deno.test("applyWarningResponse halves activation cache cap", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    resetMemoryPressureLogCountersForTests();
    setMaxCachedWasmCreatureActivations(100);
    const logger = createTestLogger();
    applyWarningResponse(logger);

    assertEquals(getMaxCachedWasmCreatureActivations(), 50);
    assertEquals(logger.messages.length > 0, true);
    assertEquals(
      logger.messages[0].includes("Warning-level response"),
      true,
    );
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("applyCriticalResponse clears caches aggressively", () => {
  const originalActivationCap = getMaxCachedWasmCreatureActivations();
  const originalCompilationCap = getWasmCompilationCacheMaxSize();
  try {
    resetMemoryPressureLogCountersForTests();
    setMaxCachedWasmCreatureActivations(200);
    setWasmCompilationCacheSize(50);
    const logger = createTestLogger();

    applyCriticalResponse(logger);

    assertEquals(getMaxCachedWasmCreatureActivations(), 1);
    assertEquals(getWasmCompilationCacheMaxSize(), 1);
    assertEquals(logger.messages.length > 0, true);
    assertEquals(
      logger.messages[0].includes("Critical-level response"),
      true,
    );
  } finally {
    setMaxCachedWasmCreatureActivations(originalActivationCap);
    setWasmCompilationCacheSize(originalCompilationCap);
  }
});

Deno.test(
  "applyWarningResponse at minimum cap does not claim a false cap reduction",
  () => {
    const originalCap = getMaxCachedWasmCreatureActivations();
    try {
      resetMemoryPressureLogCountersForTests();
      setMaxCachedWasmCreatureActivations(1);
      const logger = createTestLogger();
      applyWarningResponse(logger);

      assertEquals(logger.messages.length, 1);
      assertEquals(logger.messages[0].includes("already at"), true);
      assertEquals(logger.messages[0].includes("from 1 to 1"), false);
    } finally {
      setMaxCachedWasmCreatureActivations(originalCap);
    }
  },
);

Deno.test("checkMemoryAndEvict does nothing when below warning threshold", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(100);
    const logger = createTestLogger();
    // 50% usage — well below warning
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(500, 1000),
    );

    assertStrictEquals(result.pressureLevel, "normal");
    assertStrictEquals(result.evicted, false);
    assertStrictEquals(result.usageFraction, 0.5);
    // Cache cap unchanged
    assertEquals(getMaxCachedWasmCreatureActivations(), 100);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("checkMemoryAndEvict triggers warning response at 75% usage", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(100);
    const logger = createTestLogger();
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );

    assertStrictEquals(result.pressureLevel, "warning");
    assertStrictEquals(result.evicted, true);
    assertEquals(getMaxCachedWasmCreatureActivations(), 50);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("checkMemoryAndEvict triggers critical response at 90% usage", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  const originalCompilationCap = getWasmCompilationCacheMaxSize();
  try {
    setMaxCachedWasmCreatureActivations(100);
    setWasmCompilationCacheSize(50);
    const logger = createTestLogger();
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(900, 1000),
    );

    assertStrictEquals(result.pressureLevel, "critical");
    assertStrictEquals(result.evicted, true);
    assertEquals(getMaxCachedWasmCreatureActivations(), 1);
    assertEquals(getWasmCompilationCacheMaxSize(), 1);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
    setWasmCompilationCacheSize(originalCompilationCap);
  }
});

Deno.test("checkMemoryAndEvict handles zero heapTotal gracefully", () => {
  const logger = createTestLogger();
  const result = checkMemoryAndEvict(
    DEFAULT_MEMORY_CONFIG,
    logger,
    fakeMemoryProvider(0, 0),
  );

  assertStrictEquals(result.pressureLevel, "normal");
  assertStrictEquals(result.usageFraction, 0);
  assertStrictEquals(result.evicted, false);
});

Deno.test("checkMemoryAndEvict returns correct heap diagnostics", () => {
  const logger = createTestLogger();
  const result = checkMemoryAndEvict(
    DEFAULT_MEMORY_CONFIG,
    logger,
    fakeMemoryProvider(1024 * 1024 * 100, 1024 * 1024 * 200),
  );

  assertEquals(result.heapUsed, 1024 * 1024 * 100);
  assertEquals(result.heapTotal, 1024 * 1024 * 200);
  assertStrictEquals(result.usageFraction, 0.5);
});

Deno.test("checkMemoryAndEvict skips when disabled", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(100);
    const config: RequiredMemoryConfig = {
      ...DEFAULT_MEMORY_CONFIG,
      enabled: false,
    };
    const logger = createTestLogger();
    // Even at 95% usage, should not evict when disabled
    const result = checkMemoryAndEvict(
      config,
      logger,
      fakeMemoryProvider(950, 1000),
    );

    // When disabled, we still return the data but do not evict
    assertStrictEquals(result.evicted, false);
    assertEquals(getMaxCachedWasmCreatureActivations(), 100);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("logMemoryUsage logs formatted heap statistics", () => {
  const logger = createTestLogger();
  const result: MemoryCheckResult = {
    heapUsed: 1024 * 1024 * 500,
    heapTotal: 1024 * 1024 * 1000,
    usageFraction: 0.5,
    pressureLevel: "normal",
    evicted: false,
    backoffActive: false,
    snapshot: null,
  };

  logMemoryUsage(result, logger);

  assertEquals(logger.messages.length, 1);
  assertEquals(logger.messages[0].includes("[MemoryMonitor]"), true);
  assertEquals(logger.messages[0].includes("500 MB"), true);
  assertEquals(logger.messages[0].includes("1000 MB"), true);
  assertEquals(logger.messages[0].includes("50.0%"), true);
});

Deno.test("logMemoryUsage includes pressure level tag for warning", () => {
  const logger = createTestLogger();
  const result: MemoryCheckResult = {
    heapUsed: 700,
    heapTotal: 1000,
    usageFraction: 0.7,
    pressureLevel: "warning",
    evicted: true,
    backoffActive: false,
    snapshot: null,
  };

  logMemoryUsage(result, logger);

  assertEquals(logger.messages[0].includes("[WARNING]"), true);
});

Deno.test("logMemoryUsage includes pressure level tag for critical", () => {
  const logger = createTestLogger();
  const result: MemoryCheckResult = {
    heapUsed: 900,
    heapTotal: 1000,
    usageFraction: 0.9,
    pressureLevel: "critical",
    evicted: true,
    backoffActive: false,
    snapshot: null,
  };

  logMemoryUsage(result, logger);

  assertEquals(logger.messages[0].includes("[CRITICAL]"), true);
});

// ----------------------------------------------------------------------
// Issue #2381 — diagnostic snapshot, adaptive backoff, proactive GC.
// ----------------------------------------------------------------------

Deno.test(
  "captureMemorySnapshot returns counts from WASM caches and provider",
  () => {
    const originalCap = getMaxCachedWasmCreatureActivations();
    try {
      setMaxCachedWasmCreatureActivations(77);
      const sample = {
        heapUsed: 2048,
        heapTotal: 4096,
        rss: 8192,
        external: 1024,
        arrayBuffers: 512,
      };
      const snapshot = captureMemorySnapshot(sample, 1_234_567);

      assertEquals(snapshot.timestampMs, 1_234_567);
      assertEquals(snapshot.heapUsed, 2048);
      assertEquals(snapshot.heapTotal, 4096);
      assertEquals(snapshot.rss, 8192);
      assertEquals(snapshot.external, 1024);
      assertEquals(snapshot.arrayBuffers, 512);
      assertEquals(snapshot.wasmActivationCap, 77);
      // Entries are non-negative integers; we do not assert exact value
      // because module state is shared across the test run.
      assertEquals(snapshot.wasmActivationEntries >= 0, true);
      assertEquals(snapshot.wasmCompilationEntries >= 0, true);
      assertEquals(snapshot.wasmCompilationBytes >= 0, true);
    } finally {
      setMaxCachedWasmCreatureActivations(originalCap);
    }
  },
);

Deno.test(
  "captureMemorySnapshot defaults optional provider fields to zero",
  () => {
    const snapshot = captureMemorySnapshot(
      { heapUsed: 10, heapTotal: 20 },
      42,
    );
    assertEquals(snapshot.rss, 0);
    assertEquals(snapshot.external, 0);
    assertEquals(snapshot.arrayBuffers, 0);
  },
);

Deno.test("formatMemorySnapshot produces a single-line summary", () => {
  const snapshot: MemorySnapshot = {
    timestampMs: 1_000,
    heapUsed: 1024 * 1024 * 500,
    heapTotal: 1024 * 1024 * 1000,
    rss: 1024 * 1024 * 1200,
    external: 1024 * 1024 * 50,
    arrayBuffers: 0,
    wasmActivationEntries: 13,
    wasmActivationCap: 512,
    wasmCompilationEntries: 7,
    wasmCompilationBytes: 1024 * 1024 * 4,
  };
  const line = formatMemorySnapshot(snapshot);
  assertEquals(line.includes("[MemoryMonitor] Snapshot:"), true);
  assertEquals(line.includes("heap=500 MB/1000 MB"), true);
  assertEquals(line.includes("rss=1200 MB"), true);
  assertEquals(line.includes("external=50 MB"), true);
  assertEquals(line.includes("wasmActivation=13/512"), true);
  assertEquals(line.includes("wasmCompilation=7"), true);
  assertEquals(line.includes("4 MB"), true);
  assertEquals(line.includes("\n"), false);
});

Deno.test("checkMemoryAndEvict emits snapshot when heap crosses threshold", () => {
  resetMemoryPressureLogCountersForTests();
  const logger = createTestLogger();
  const clock = fakeClock();
  const result = checkMemoryAndEvict(
    DEFAULT_MEMORY_CONFIG,
    logger,
    fakeMemoryProvider(900, 1000, { rss: 1200, external: 100 }),
    clock.now,
  );
  assertEquals(result.snapshot !== null, true);
  assertEquals(
    logger.messages.some((m) => m.includes("[MemoryMonitor] Snapshot:")),
    true,
  );
});

Deno.test(
  "checkMemoryAndEvict suppresses snapshot below snapshotThreshold",
  () => {
    resetMemoryPressureLogCountersForTests();
    const logger = createTestLogger();
    const clock = fakeClock();
    // 85% >= critical but < default snapshot threshold of 90%.
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(850, 1000),
      clock.now,
    );
    assertStrictEquals(result.pressureLevel, "critical");
    assertStrictEquals(result.snapshot, null);
  },
);

Deno.test(
  "checkMemoryAndEvict throttles snapshot emission within snapshotIntervalMs",
  () => {
    resetMemoryPressureLogCountersForTests();
    const logger = createTestLogger();
    const clock = fakeClock();
    const first = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(950, 1000),
      clock.now,
    );
    assertEquals(first.snapshot !== null, true);

    // Advance less than the throttling interval — no new snapshot.
    clock.advance(1000);
    const second = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(950, 1000),
      clock.now,
    );
    assertStrictEquals(second.snapshot, null);

    // Advance past the interval — snapshot fires again.
    clock.advance(DEFAULT_MEMORY_CONFIG.snapshotIntervalMs);
    const third = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(950, 1000),
      clock.now,
    );
    assertEquals(third.snapshot !== null, true);
  },
);

Deno.test(
  "checkMemoryAndEvict adaptive backoff suppresses critical response after burst",
  () => {
    resetMemoryPressureLogCountersForTests();
    const originalCap = getMaxCachedWasmCreatureActivations();
    try {
      const config: RequiredMemoryConfig = {
        ...DEFAULT_MEMORY_CONFIG,
        criticalBackoffBurst: 3,
        criticalBackoffWindowMs: 1_000,
        criticalBackoffCooldownMs: 10_000,
        // Disable snapshots to isolate the backoff behaviour.
        snapshotThreshold: 1.0,
      };
      const logger = createTestLogger();
      const clock = fakeClock();

      // Fire critical responses until the burst limit is exceeded.
      for (let i = 0; i < config.criticalBackoffBurst + 1; i++) {
        setMaxCachedWasmCreatureActivations(100);
        const r = checkMemoryAndEvict(
          config,
          logger,
          fakeMemoryProvider(950, 1000),
          clock.now,
        );
        assertStrictEquals(r.pressureLevel, "critical");
        assertStrictEquals(r.evicted, true);
        assertStrictEquals(r.backoffActive, false);
        clock.advance(10);
      }

      // Next critical should be suppressed.
      setMaxCachedWasmCreatureActivations(100);
      const suppressed = checkMemoryAndEvict(
        config,
        logger,
        fakeMemoryProvider(950, 1000),
        clock.now,
      );
      assertStrictEquals(suppressed.pressureLevel, "critical");
      assertStrictEquals(suppressed.evicted, false);
      assertStrictEquals(suppressed.backoffActive, true);
      // Cache cap was NOT reduced — backoff prevented the thrash.
      assertEquals(getMaxCachedWasmCreatureActivations(), 100);

      // Advance past the cooldown — critical fires again.
      clock.advance(config.criticalBackoffCooldownMs + 1);
      setMaxCachedWasmCreatureActivations(100);
      const recovered = checkMemoryAndEvict(
        config,
        logger,
        fakeMemoryProvider(950, 1000),
        clock.now,
      );
      assertStrictEquals(recovered.backoffActive, false);
      assertStrictEquals(recovered.evicted, true);
      assertEquals(getMaxCachedWasmCreatureActivations(), 1);

      // Logger recorded the burst-exceeded and backoff notifications.
      const logText = logger.messages.join("\n");
      assertEquals(logText.includes("burst limit"), true);
      assertEquals(logText.includes("backoff active"), true);
    } finally {
      setMaxCachedWasmCreatureActivations(originalCap);
      resetMemoryPressureLogCountersForTests();
    }
  },
);

Deno.test(
  "checkMemoryAndEvict does not engage backoff when critical responses are spaced out",
  () => {
    resetMemoryPressureLogCountersForTests();
    const originalCap = getMaxCachedWasmCreatureActivations();
    try {
      const config: RequiredMemoryConfig = {
        ...DEFAULT_MEMORY_CONFIG,
        criticalBackoffBurst: 3,
        criticalBackoffWindowMs: 1_000,
        criticalBackoffCooldownMs: 10_000,
        snapshotThreshold: 1.0,
      };
      const logger = createTestLogger();
      const clock = fakeClock();

      // Ten critical responses spaced more than the window apart —
      // backoff must never trigger.
      for (let i = 0; i < 10; i++) {
        setMaxCachedWasmCreatureActivations(100);
        const r = checkMemoryAndEvict(
          config,
          logger,
          fakeMemoryProvider(950, 1000),
          clock.now,
        );
        assertStrictEquals(r.backoffActive, false);
        assertStrictEquals(r.evicted, true);
        clock.advance(config.criticalBackoffWindowMs + 100);
      }
    } finally {
      setMaxCachedWasmCreatureActivations(originalCap);
      resetMemoryPressureLogCountersForTests();
    }
  },
);

Deno.test("checkMemoryAndEvict proactiveGc invokes globalThis.gc when present", () => {
  resetMemoryPressureLogCountersForTests();
  const originalCap = getMaxCachedWasmCreatureActivations();
  const globalAny = globalThis as { gc?: () => void };
  const originalGc = globalAny.gc;
  try {
    let gcCalls = 0;
    globalAny.gc = () => {
      gcCalls++;
    };
    const config: RequiredMemoryConfig = {
      ...DEFAULT_MEMORY_CONFIG,
      proactiveGc: true,
      snapshotThreshold: 1.0,
    };
    const logger = createTestLogger();
    setMaxCachedWasmCreatureActivations(100);
    const result = checkMemoryAndEvict(
      config,
      logger,
      fakeMemoryProvider(950, 1000),
    );
    assertStrictEquals(result.pressureLevel, "critical");
    assertStrictEquals(gcCalls, 1);
  } finally {
    if (originalGc === undefined) {
      delete (globalAny as { gc?: () => void }).gc;
    } else {
      globalAny.gc = originalGc;
    }
    setMaxCachedWasmCreatureActivations(originalCap);
    resetMemoryPressureLogCountersForTests();
  }
});

Deno.test("attemptProactiveGc returns false when gc is not exposed", () => {
  const globalAny = globalThis as { gc?: () => void };
  const originalGc = globalAny.gc;
  try {
    delete (globalAny as { gc?: () => void }).gc;
    assertStrictEquals(attemptProactiveGc(), false);
  } finally {
    if (originalGc !== undefined) globalAny.gc = originalGc;
  }
});

Deno.test("attemptProactiveGc returns true and invokes gc when exposed", () => {
  const globalAny = globalThis as { gc?: () => void };
  const originalGc = globalAny.gc;
  try {
    let called = false;
    globalAny.gc = () => {
      called = true;
    };
    assertStrictEquals(attemptProactiveGc(), true);
    assertStrictEquals(called, true);
  } finally {
    if (originalGc === undefined) {
      delete (globalAny as { gc?: () => void }).gc;
    } else {
      globalAny.gc = originalGc;
    }
  }
});

Deno.test(
  "resetMemoryPressureLogCountersForTests also clears snapshot and backoff state",
  () => {
    const originalCap = getMaxCachedWasmCreatureActivations();
    try {
      // Prime snapshot state.
      setMaxCachedWasmCreatureActivations(100);
      const logger = createTestLogger();
      const clock = fakeClock();
      checkMemoryAndEvict(
        DEFAULT_MEMORY_CONFIG,
        logger,
        fakeMemoryProvider(950, 1000),
        clock.now,
      );

      resetMemoryPressureLogCountersForTests();

      // Immediately after reset, a new snapshot should be taken even at
      // the same clock tick.
      setMaxCachedWasmCreatureActivations(100);
      const result = checkMemoryAndEvict(
        DEFAULT_MEMORY_CONFIG,
        logger,
        fakeMemoryProvider(950, 1000),
        clock.now,
      );
      assertEquals(result.snapshot !== null, true);
    } finally {
      setMaxCachedWasmCreatureActivations(originalCap);
      resetMemoryPressureLogCountersForTests();
    }
  },
);
