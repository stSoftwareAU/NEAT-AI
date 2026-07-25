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
  resolveHeapLimit,
} from "@neat/MemoryMonitor.ts";
import type { Logger } from "@utils/Logger.ts";

/** A snapshot taken at the analysis-extension decision point. */
export interface HeapGuardSample {
  usageFraction: number;
  pressureLevel: PressureLevel;
  heapUsed: number;
  heapTotal: number;
  /**
   * The V8 old-space heap **limit** in bytes — the real OOM ceiling used as the
   * pressure denominator, shared with `MemoryMonitor` via `resolveHeapLimit`
   * (Issue #3433). Falls back to the committed `heapTotal` when the provider
   * does not report the limit.
   */
  heapLimit: number;
  /**
   * Resident-set size in bytes (off-heap / native / Rust + V8). Issue #3025.
   * `0` when the provider does not report RSS.
   */
  rss: number;
  /** External (non-heap) bytes attributed to V8. `0` when unreported. */
  external: number;
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
 * Returns the raw sample together with the derived `pressureLevel`. The usage
 * fraction divides `heapUsed` by the real V8 old-space **limit** resolved via
 * the shared `resolveHeapLimit` helper — the same denominator `MemoryMonitor`
 * uses (Issue #3433) — not the committed `heapTotal`, which starts small and
 * grows over the run. Dividing by `heapTotal` made the guard read CRITICAL
 * against a tiny committed heap and disagree with `MemoryMonitor` on the same
 * sample. When the resolved limit is 0 (e.g. a runtime that exposes neither the
 * limit nor `heapTotal`), the sample is treated as `normal` — we never abort
 * discovery on missing telemetry.
 */
export function sampleHeapPressure(
  memoryConfig: RequiredMemoryConfig,
  provider?: MemoryUsageProvider,
): HeapGuardSample {
  const effectiveProvider = provider ?? _providerOverride ??
    defaultMemoryUsageProvider;
  const sample = effectiveProvider();
  const heapLimit = resolveHeapLimit(sample);
  const usageFraction = heapLimit > 0 ? sample.heapUsed / heapLimit : 0;
  const pressureLevel = heapLimit > 0
    ? determinePressureLevel(usageFraction, memoryConfig)
    : "normal";
  return {
    usageFraction,
    pressureLevel,
    heapUsed: sample.heapUsed,
    heapTotal: sample.heapTotal,
    heapLimit,
    rss: sample.rss ?? 0,
    external: sample.external ?? 0,
  };
}

/**
 * Pure, unit-testable abort decision (Issue #3025).
 *
 * The discovery worker runs on a small default V8 heap, so after recording the
 * V8 heap fraction sits near the critical threshold while the bulk of memory is
 * off-heap (native/Rust) RSS that still has plenty of headroom. Deciding solely
 * on the V8 fraction mis-classifies such a healthy run as fatal.
 *
 * The rule, in order:
 * 1. Monitoring disabled → never abort (legacy behaviour).
 * 2. Not CRITICAL → never abort.
 * 3. No native budget configured (`nativeBudgetBytes <= 0`) → legacy V8-only
 *    decision: a CRITICAL V8 fraction aborts.
 * 4. RSS unreported (`rss <= 0`) → cannot trust off-heap headroom, so fall back
 *    to the legacy decision and abort. Missing telemetry never silently
 *    disables the safeguard.
 * 5. RSS exceeds the budget → abort (genuine OOM is never masked).
 * 6. Otherwise the CRITICAL is driven only by the V8 fraction while RSS is
 *    within budget → do NOT abort.
 */
export function shouldAbortOnHeapPressure(
  sample: HeapGuardSample,
  memoryConfig: RequiredMemoryConfig,
): boolean {
  if (!memoryConfig.enabled) return false;
  if (sample.pressureLevel !== "critical") return false;

  const budget = memoryConfig.nativeBudgetBytes;
  if (budget <= 0) return true; // off-heap awareness not configured
  if (sample.rss <= 0) return true; // RSS unknown — keep the legacy safeguard
  if (sample.rss > budget) return true; // genuine OOM — RSS over budget

  // Worker-V8-only CRITICAL with off-heap headroom — safe to continue.
  return false;
}

/**
 * Returns true when the most recent heap sample warrants skipping the
 * extension / aborting the analysis loop.
 *
 * Delegates to {@link shouldAbortOnHeapPressure}, so a worker-V8-only CRITICAL
 * sample no longer trips when an off-heap (RSS) budget is configured and RSS
 * has headroom (Issue #3025). Honours `memoryConfig.enabled` — when monitoring
 * is disabled the guard never trips, preserving legacy behaviour.
 */
export function isHeapCritical(
  memoryConfig: RequiredMemoryConfig,
  provider?: MemoryUsageProvider,
): boolean {
  if (!memoryConfig.enabled) return false;
  const sample = sampleHeapPressure(memoryConfig, provider);
  return shouldAbortOnHeapPressure(sample, memoryConfig);
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
  if (shouldAbortOnHeapPressure(sample, memoryConfig)) {
    logger.warn(
      `[Neat] Discovery ${discoveryID} analysis aborted: heap CRITICAL at extension boundary`,
    );
    return { abort: true, sample };
  }
  return { abort: false, sample };
}
