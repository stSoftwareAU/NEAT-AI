import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  applyCriticalResponse,
  applyWarningResponse,
  checkMemoryAndEvict,
  determinePressureLevel,
  logMemoryUsage,
  type MemoryCheckResult,
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
): MemoryUsageProvider {
  return () => ({ heapUsed, heapTotal });
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
  };

  logMemoryUsage(result, logger);

  assertEquals(logger.messages[0].includes("[CRITICAL]"), true);
});
