/**
 * Tests for RuntimeParsers (Issue #2396).
 *
 * Verify happy-path defaults, override application, and invalid-input
 * rejection for the runtime/system limit parsers.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import { DEFAULT_PARALLEL_EVALUATION_CONFIG } from "@config/ParallelEvaluationConfig.ts";
import { DEFAULT_WASM_CACHE_CONFIG } from "@config/WasmCacheConfig.ts";
import { DEFAULT_WORKER_THREAD_CAP_CONFIG } from "@config/WorkerThreadCapConfig.ts";
import {
  parseMemoryConfig,
  parseParallelEvaluation,
  parseWasmCache,
  parseWorkerThreadCap,
} from "@config/parsers/RuntimeParsers.ts";

Deno.test("parseWorkerThreadCap - returns defaults when no overrides", () => {
  const cfg = parseWorkerThreadCap(undefined);
  assertEquals(cfg.maxMemoryMB, DEFAULT_WORKER_THREAD_CAP_CONFIG.maxMemoryMB);
  assertEquals(
    cfg.estimatedMemoryPerWorkerMB,
    DEFAULT_WORKER_THREAD_CAP_CONFIG.estimatedMemoryPerWorkerMB,
  );
});

Deno.test("parseWorkerThreadCap - applies overrides", () => {
  const cfg = parseWorkerThreadCap({
    maxMemoryMB: 8192,
    estimatedMemoryPerWorkerMB: 256,
  });
  assertEquals(cfg.maxMemoryMB, 8192);
  assertEquals(cfg.estimatedMemoryPerWorkerMB, 256);
});

Deno.test("parseWorkerThreadCap - rejects estimatedMemoryPerWorkerMB below 1", () => {
  assertThrows(
    () => parseWorkerThreadCap({ estimatedMemoryPerWorkerMB: 0 }),
    ConfigurationError,
  );
});

Deno.test("parseWasmCache - returns defaults derived from population size", () => {
  const cfg = parseWasmCache(undefined, 50);
  assertEquals(cfg.maxCachedActivations, 100);
  assertEquals(
    cfg.compilationCacheSize,
    DEFAULT_WASM_CACHE_CONFIG.compilationCacheSize,
  );
});

Deno.test("parseWasmCache - rejects non-integer maxCachedActivations", () => {
  assertThrows(
    () => parseWasmCache({ maxCachedActivations: 3.5 }, 10),
    ConfigurationError,
  );
});

Deno.test("parseMemoryConfig - returns defaults when no overrides", () => {
  const cfg = parseMemoryConfig(undefined);
  assertEquals(cfg.enabled, DEFAULT_MEMORY_CONFIG.enabled);
  assertEquals(cfg.warningThreshold, DEFAULT_MEMORY_CONFIG.warningThreshold);
  assertEquals(cfg.proactiveGc, DEFAULT_MEMORY_CONFIG.proactiveGc);
});

Deno.test("parseMemoryConfig - applies enabled override and thresholds", () => {
  const cfg = parseMemoryConfig({
    enabled: true,
    warningThreshold: 0.7,
    criticalThreshold: 0.9,
  });
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.warningThreshold, 0.7);
  assertEquals(cfg.criticalThreshold, 0.9);
});

Deno.test("parseMemoryConfig - rejects warningThreshold above 1", () => {
  assertThrows(
    () => parseMemoryConfig({ warningThreshold: 1.5 }),
    ConfigurationError,
  );
});

Deno.test("parseParallelEvaluation - returns defaults when no overrides", () => {
  const cfg = parseParallelEvaluation(undefined);
  assertEquals(
    cfg.maxConcurrentEvaluations,
    DEFAULT_PARALLEL_EVALUATION_CONFIG.maxConcurrentEvaluations,
  );
  assertEquals(
    cfg.topologyGrouping,
    DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping,
  );
});

Deno.test("parseParallelEvaluation - applies overrides", () => {
  const cfg = parseParallelEvaluation({
    maxConcurrentEvaluations: 4,
    topologyGrouping: !DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping,
  });
  assertEquals(cfg.maxConcurrentEvaluations, 4);
  assertEquals(
    cfg.topologyGrouping,
    !DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping,
  );
});

Deno.test("parseParallelEvaluation - rejects negative maxConcurrentEvaluations", () => {
  assertThrows(
    () => parseParallelEvaluation({ maxConcurrentEvaluations: -1 }),
    ConfigurationError,
  );
});
