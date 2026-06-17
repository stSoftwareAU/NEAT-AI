/**
 * RuntimeParsers.ts - Sub-config parsers for runtime/system limits.
 *
 * Extracted from NeatConfigParsers.ts (Issue #2396) to keep each parser
 * group focused on a single concern. This file holds parsers for
 * worker-thread caps, WASM caches, memory monitoring, and parallel
 * evaluation throttling.
 */

import {
  DEFAULT_MEMORY_CONFIG,
  type RequiredMemoryConfig,
} from "@config/MemoryConfig.ts";
import {
  DEFAULT_PARALLEL_EVALUATION_CONFIG,
  type RequiredParallelEvaluationConfig,
} from "@config/ParallelEvaluationConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";
import {
  DEFAULT_WASM_CACHE_CONFIG,
  type RequiredWasmCacheConfig,
} from "@config/WasmCacheConfig.ts";
import {
  DEFAULT_WORKER_THREAD_CAP_CONFIG,
  type RequiredWorkerThreadCapConfig,
} from "@config/WorkerThreadCapConfig.ts";

/** Parse worker thread cap configuration (Issue #1569). */
export function parseWorkerThreadCap(
  overrides: Record<string, unknown> | undefined,
): RequiredWorkerThreadCapConfig {
  const d = DEFAULT_WORKER_THREAD_CAP_CONFIG;
  return {
    maxMemoryMB: parseNumber(
      "Worker thread cap maxMemoryMB",
      overrides?.maxMemoryMB,
      d.maxMemoryMB,
      { min: 0 },
    ),
    estimatedMemoryPerWorkerMB: parseNumber(
      "Worker thread cap estimatedMemoryPerWorkerMB",
      overrides?.estimatedMemoryPerWorkerMB,
      d.estimatedMemoryPerWorkerMB,
      { min: 1 },
    ),
  } as RequiredWorkerThreadCapConfig;
}

/** Parse WASM cache configuration (Issue #1566). */
export function parseWasmCache(
  overrides: Record<string, unknown> | undefined,
  populationSize: number,
): RequiredWasmCacheConfig {
  const d = DEFAULT_WASM_CACHE_CONFIG;
  return {
    maxCachedActivations: parseNumber(
      "WASM cache maxCachedActivations",
      overrides?.maxCachedActivations,
      populationSize * 2,
      { integer: true, min: 1 },
    ),
    compilationCacheSize: parseNumber(
      "WASM cache compilationCacheSize",
      overrides?.compilationCacheSize,
      d.compilationCacheSize,
      { integer: true, min: 1 },
    ),
  } as RequiredWasmCacheConfig;
}

/** Parse memory monitoring configuration (Issue #1565). */
export function parseMemoryConfig(
  overrides: Record<string, unknown> | undefined,
): RequiredMemoryConfig {
  const d = DEFAULT_MEMORY_CONFIG;
  const enabled = overrides?.enabled !== undefined
    ? Boolean(overrides.enabled)
    : d.enabled;
  return {
    enabled,
    warningThreshold: parseNumber(
      "Memory warningThreshold",
      overrides?.warningThreshold,
      d.warningThreshold,
      { min: 0, max: 1 },
    ),
    criticalThreshold: parseNumber(
      "Memory criticalThreshold",
      overrides?.criticalThreshold,
      d.criticalThreshold,
      { min: 0, max: 1 },
    ),
    snapshotThreshold: parseNumber(
      "Memory snapshotThreshold",
      overrides?.snapshotThreshold,
      d.snapshotThreshold,
      { min: 0, max: 1 },
    ),
    snapshotIntervalMs: parseNumber(
      "Memory snapshotIntervalMs",
      overrides?.snapshotIntervalMs,
      d.snapshotIntervalMs,
      { integer: true, min: 0 },
    ),
    criticalBackoffBurst: parseNumber(
      "Memory criticalBackoffBurst",
      overrides?.criticalBackoffBurst,
      d.criticalBackoffBurst,
      { integer: true, min: 1 },
    ),
    criticalBackoffWindowMs: parseNumber(
      "Memory criticalBackoffWindowMs",
      overrides?.criticalBackoffWindowMs,
      d.criticalBackoffWindowMs,
      { integer: true, min: 0 },
    ),
    criticalBackoffCooldownMs: parseNumber(
      "Memory criticalBackoffCooldownMs",
      overrides?.criticalBackoffCooldownMs,
      d.criticalBackoffCooldownMs,
      { integer: true, min: 0 },
    ),
    proactiveGc: overrides?.proactiveGc !== undefined
      ? Boolean(overrides.proactiveGc)
      : d.proactiveGc,
    nativeBudgetBytes: parseNumber(
      "Memory nativeBudgetBytes",
      overrides?.nativeBudgetBytes,
      d.nativeBudgetBytes,
      { integer: true, min: 0 },
    ),
  } as RequiredMemoryConfig;
}

/** Parse parallel evaluation configuration (Issue #1862). */
export function parseParallelEvaluation(
  overrides: Record<string, unknown> | undefined,
): RequiredParallelEvaluationConfig {
  const d = DEFAULT_PARALLEL_EVALUATION_CONFIG;
  return {
    maxConcurrentEvaluations: parseNumber(
      "Parallel evaluation maxConcurrentEvaluations",
      overrides?.maxConcurrentEvaluations,
      d.maxConcurrentEvaluations,
      { integer: true, min: 0 },
    ),
    topologyGrouping: typeof overrides?.topologyGrouping === "boolean"
      ? overrides.topologyGrouping
      : d.topologyGrouping,
  } satisfies RequiredParallelEvaluationConfig;
}
