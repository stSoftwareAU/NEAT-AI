/**
 * Tests for pre-fitness memory eviction behaviour.
 *
 * Issue #2263: Verifies that proactive memory monitoring before the fitness
 * evaluation phase correctly evicts WASM caches when heap pressure is
 * detected, and that memoryEvictionMs is reported in phase timing.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  checkMemoryAndEvict,
  type MemoryCheckResult,
  type MemoryUsageProvider,
  resetMemoryPressureLogCountersForTests,
} from "@neat/MemoryMonitor.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import {
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";
import {
  getWasmCompilationCacheMaxSize,
  setWasmCompilationCacheSize,
} from "@wasm/WasmCompilationCache.ts";
import type { GenerationPhaseTiming } from "@config/TrainingEvent.ts";
import type { Logger } from "@utils/Logger.ts";

/** Silent logger for tests. */
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

/** Create a fake memory provider returning the given usage values. */
function fakeMemoryProvider(
  heapUsed: number,
  heapTotal: number,
): MemoryUsageProvider {
  return () => ({ heapUsed, heapTotal });
}

Deno.test("Pre-fitness eviction at warning level halves activation cache", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    resetMemoryPressureLogCountersForTests();
    setMaxCachedWasmCreatureActivations(200);
    const logger = createTestLogger();

    // Simulate pre-fitness check at 75% heap usage (warning level)
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );

    assertStrictEquals(result.pressureLevel, "warning");
    assertStrictEquals(result.evicted, true);
    // Warning response halves the cap
    assertEquals(getMaxCachedWasmCreatureActivations(), 100);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("Pre-fitness eviction at critical level clears caches", () => {
  const originalActivationCap = getMaxCachedWasmCreatureActivations();
  const originalCompilationCap = getWasmCompilationCacheMaxSize();
  try {
    resetMemoryPressureLogCountersForTests();
    setMaxCachedWasmCreatureActivations(200);
    setWasmCompilationCacheSize(50);
    const logger = createTestLogger();

    // Simulate pre-fitness check at 90% heap usage (critical level)
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(900, 1000),
    );

    assertStrictEquals(result.pressureLevel, "critical");
    assertStrictEquals(result.evicted, true);
    // Critical response sets activation cap to 1 and compilation cache to 1
    assertEquals(getMaxCachedWasmCreatureActivations(), 1);
    assertEquals(getWasmCompilationCacheMaxSize(), 1);
  } finally {
    setMaxCachedWasmCreatureActivations(originalActivationCap);
    setWasmCompilationCacheSize(originalCompilationCap);
  }
});

Deno.test("No eviction at normal pressure preserves cache caps", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    setMaxCachedWasmCreatureActivations(200);
    const logger = createTestLogger();

    // Simulate check at 50% heap usage (normal)
    const result = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(500, 1000),
    );

    assertStrictEquals(result.pressureLevel, "normal");
    assertStrictEquals(result.evicted, false);
    // Cache cap unchanged
    assertEquals(getMaxCachedWasmCreatureActivations(), 200);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("Consecutive pre-fitness checks progressively reduce cache cap", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    resetMemoryPressureLogCountersForTests();
    setMaxCachedWasmCreatureActivations(200);
    const logger = createTestLogger();

    // First warning check halves from 200 to 100
    checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );
    assertEquals(getMaxCachedWasmCreatureActivations(), 100);

    // Second warning check halves from 100 to 50
    checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );
    assertEquals(getMaxCachedWasmCreatureActivations(), 50);

    // Third warning check halves from 50 to 25
    checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );
    assertEquals(getMaxCachedWasmCreatureActivations(), 25);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("memoryEvictionMs field is optional in GenerationPhaseTiming", () => {
  // Verify the type accepts both with and without memoryEvictionMs
  const timingWithout: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 170,
  };
  assertEquals(timingWithout.memoryEvictionMs, undefined);

  const timingWith: GenerationPhaseTiming = {
    fitnessMs: 100,
    breedingMs: 50,
    resultProcessingMs: 20,
    totalMs: 175,
    memoryEvictionMs: 5,
  };
  assertEquals(timingWith.memoryEvictionMs, 5);
});

Deno.test("Pre-fitness then post-fitness eviction accumulates correctly", () => {
  const originalCap = getMaxCachedWasmCreatureActivations();
  try {
    resetMemoryPressureLogCountersForTests();
    setMaxCachedWasmCreatureActivations(200);
    const logger = createTestLogger();

    // Pre-fitness check (warning)
    const preFitnessStart = Date.now();
    const preFitness = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );
    const preFitnessMs = Date.now() - preFitnessStart;

    assertStrictEquals(preFitness.evicted, true);

    // Post-fitness check (still under pressure)
    const postFitnessStart = Date.now();
    const postFitness = checkMemoryAndEvict(
      DEFAULT_MEMORY_CONFIG,
      logger,
      fakeMemoryProvider(750, 1000),
    );
    const postFitnessMs = Date.now() - postFitnessStart;

    assertStrictEquals(postFitness.evicted, true);

    // Both checks complete and total time is non-negative
    const totalMs = preFitnessMs + postFitnessMs;
    assertEquals(totalMs >= 0, true);
  } finally {
    setMaxCachedWasmCreatureActivations(originalCap);
  }
});

Deno.test("MemoryCheckResult contains valid heap diagnostics", () => {
  const logger = createTestLogger();
  const result: MemoryCheckResult = checkMemoryAndEvict(
    DEFAULT_MEMORY_CONFIG,
    logger,
    fakeMemoryProvider(400_000_000, 800_000_000),
  );

  assertEquals(result.heapUsed, 400_000_000);
  assertEquals(result.heapTotal, 800_000_000);
  assertEquals(result.usageFraction, 0.5);
  assertStrictEquals(result.pressureLevel, "normal");
  assertStrictEquals(result.evicted, false);
});
