/**
 * Heap-aware guard for the discovery analysis-extension boundary.
 *
 * Issue #2594: When the recording phase finishes, `DataRecorder.recordFiles`
 * unconditionally extends the discovery timeout to give analysis room to run.
 * If the heap is already at `MemoryMonitor` CRITICAL pressure (≥85% by
 * default), continuing into analysis tends to OOM the worker — the
 * `MemoryMonitor` critical-level response (clear WASM caches, drop the
 * activation cap to 1) is not enough to free the retainer that pushed the
 * heap over the threshold in the first place.
 *
 * This module provides a small, side-effect-light helper that samples the
 * heap at the extension boundary and tells `DataRecorder` whether to skip
 * the extension and return a partial result instead. The heap sample is
 * obtained via the same `MemoryUsageProvider` abstraction used by
 * `MemoryMonitor`, so tests can inject deterministic samples without
 * touching the runtime.
 */

import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import {
  defaultMemoryUsageProvider,
  determinePressureLevel,
  type MemoryUsageProvider,
  type PressureLevel,
} from "@neat/MemoryMonitor.ts";
import type { Logger } from "@utils/Logger.ts";

/** A snapshot taken at the analysis-extension decision point. */
export interface HeapGuardSample {
  usageFraction: number;
  pressureLevel: PressureLevel;
  heapUsed: number;
  heapTotal: number;
}

/**
 * Module-level injectable provider override. Defaults to
 * `defaultMemoryUsageProvider` (i.e. `Deno.memoryUsage()`).
 *
 * Tests use {@link _setHeapGuardProviderForTests} to swap in a deterministic
 * sample without threading the provider through the production call chain.
 */
let _providerOverride: MemoryUsageProvider | undefined;

/**
 * Test-only setter. Pass `undefined` to restore the default provider.
 *
 * Exported with a leading underscore to signal it is not part of the public
 * runtime API; production code must never call this.
 */
export function _setHeapGuardProviderForTests(
  provider: MemoryUsageProvider | undefined,
): void {
  _providerOverride = provider;
}

/**
 * Sample the current heap pressure using the configured thresholds.
 *
 * Returns the raw sample together with the derived `pressureLevel`. When
 * `heapTotal` is reported as 0 (e.g. on a runtime that does not expose heap
 * stats), the sample is treated as `normal` — we never abort discovery on
 * missing telemetry.
 */
export function sampleHeapPressure(
  memoryConfig: RequiredMemoryConfig,
  provider?: MemoryUsageProvider,
): HeapGuardSample {
  const effectiveProvider = provider ?? _providerOverride ??
    defaultMemoryUsageProvider;
  const sample = effectiveProvider();
  const usageFraction = sample.heapTotal > 0
    ? sample.heapUsed / sample.heapTotal
    : 0;
  const pressureLevel = sample.heapTotal > 0
    ? determinePressureLevel(usageFraction, memoryConfig)
    : "normal";
  return {
    usageFraction,
    pressureLevel,
    heapUsed: sample.heapUsed,
    heapTotal: sample.heapTotal,
  };
}

/**
 * Returns true when the most recent heap sample is at or above the
 * `MemoryMonitor` CRITICAL threshold and the extension should be skipped.
 *
 * Honours `memoryConfig.enabled` — when monitoring is disabled the guard
 * never trips, preserving the legacy unconditional-extension behaviour.
 */
export function isHeapCritical(
  memoryConfig: RequiredMemoryConfig,
  provider?: MemoryUsageProvider,
): boolean {
  if (!memoryConfig.enabled) return false;
  return sampleHeapPressure(memoryConfig, provider).pressureLevel ===
    "critical";
}

/**
 * Decision helper used by `DataRecorder` at the analysis-extension
 * boundary. When the heap is CRITICAL, emit a single grep-friendly log
 * line and signal that the caller should skip the extension; otherwise
 * report no abort and let the existing flow run.
 *
 * The log format matches the `[Subsystem]` prefix style used by
 * `[MemoryMonitor]` so it joins the same observability pipeline.
 */
export function checkAnalysisHeapAbort(
  discoveryID: string,
  memoryConfig: RequiredMemoryConfig,
  logger: Logger,
  provider?: MemoryUsageProvider,
): { abort: boolean; sample: HeapGuardSample } {
  const sample = sampleHeapPressure(memoryConfig, provider);
  if (memoryConfig.enabled && sample.pressureLevel === "critical") {
    logger.warn(
      `[Neat] Discovery ${discoveryID} analysis aborted: heap CRITICAL at extension boundary`,
    );
    return { abort: true, sample };
  }
  return { abort: false, sample };
}
