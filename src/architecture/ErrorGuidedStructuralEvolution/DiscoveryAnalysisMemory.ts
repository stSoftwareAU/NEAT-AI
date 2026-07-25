/**
 * Host-side wiring for the NEAT-AI-Discovery analysis-memory FFI (Issue #3432).
 *
 * NEAT-AI-Discovery already ships three analysis-memory controls, none of
 * which NEAT-AI used on the parallel-analysis path:
 *
 * | Discovery API                       | Role                                  |
 * | ----------------------------------- | ------------------------------------- |
 * | `maxAnalysisMemoryMb` (#1028)       | Rust-side budget; omit ⇒ no budget    |
 * | `discovery_memory_usage_bytes` (#1027) | Rust allocator footprint, pollable |
 * | `cancel_analysis_memory_pressure` (#1099) | Abort an in-flight analysis    |
 *
 * The host's own guards (`MemoryMonitor`, `AnalysisHeapGuard`) only ever see
 * V8 heap and RSS samples taken from Deno, so they can neither observe
 * Discovery's analysis footprint nor stop an analysis that is already running
 * inside a blocking FFI call. This module supplies the missing half: a pure
 * cancellation decision, a diagnostic formatter, and a signal helper with
 * injectable FFI dependencies so the wiring is unit-testable without a GPU or
 * a built Rust library.
 */

import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import {
  type HeapGuardSample,
  sampleHeapPressure,
  shouldAbortOnHeapPressure,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import {
  cancelAnalysisMemoryPressure,
  getDiscoveryMemoryUsageBytes,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryLibrary.ts";
import type { MemoryUsageProvider } from "@neat/MemoryMonitor.ts";
import type { Logger } from "@utils/Logger.ts";

/**
 * FFI seam for the analysis-memory controls. Production code uses
 * {@link DEFAULT_DISCOVERY_ANALYSIS_MEMORY_DEPS}; tests inject fakes.
 */
export interface DiscoveryAnalysisMemoryDeps {
  /** Rust allocator footprint in bytes, or `undefined` when unavailable. */
  readonly usageBytes: () => number | undefined;
  /** Signals memory-pressure cancellation; false when unavailable. */
  readonly cancelMemoryPressure: () => boolean;
}

/** Production dependencies — the real NEAT-AI-Discovery FFI surface. */
export const DEFAULT_DISCOVERY_ANALYSIS_MEMORY_DEPS:
  DiscoveryAnalysisMemoryDeps = {
    usageBytes: getDiscoveryMemoryUsageBytes,
    cancelMemoryPressure: cancelAnalysisMemoryPressure,
  };

/**
 * Resolves the analysis memory budget to send on `analyze_parallel`.
 *
 * Returns `undefined` when no budget is configured, which keeps the field off
 * the wire entirely — Discovery treats an omitted `maxAnalysisMemoryMb` as
 * "no budget", so sending `0` would be wrong (it would starve the analysis
 * immediately rather than disable the limit).
 */
export function resolveAnalysisMemoryBudgetMb(
  memoryConfig: Pick<RequiredMemoryConfig, "maxAnalysisMemoryMb">,
): number | undefined {
  const budget = memoryConfig.maxAnalysisMemoryMb;
  if (!Number.isFinite(budget) || budget <= 0) {
    return undefined;
  }
  return Math.floor(budget);
}

/**
 * Pure decision: should the host ask Discovery to abort an in-flight analysis?
 *
 * The rule, in order:
 * 1. Monitoring disabled → never cancel (legacy behaviour, matches
 *    {@link shouldAbortOnHeapPressure}).
 * 2. A configured native (RSS) budget is exceeded → cancel, even when the V8
 *    fraction itself is healthy. This is the off-heap growth the host cannot
 *    otherwise see, and it is exactly what pushes an `evolveDir` run into OOM.
 * 3. Otherwise defer to the existing heap-guard rule so a worker-V8-only
 *    CRITICAL with off-heap headroom (Issue #3025) does **not** cancel a
 *    healthy analysis.
 */
export function shouldCancelAnalysisForMemoryPressure(
  sample: HeapGuardSample,
  memoryConfig: RequiredMemoryConfig,
): boolean {
  if (!memoryConfig.enabled) return false;
  if (
    memoryConfig.nativeBudgetBytes > 0 &&
    sample.rss > memoryConfig.nativeBudgetBytes
  ) {
    return true;
  }
  return shouldAbortOnHeapPressure(sample, memoryConfig);
}

/**
 * Formats the Discovery-reported allocator footprint for diagnostic logs.
 *
 * Returns `discovery=unavailable` when the FFI surface is missing so a stale
 * library shows up in the log rather than being mistaken for zero usage.
 */
export function formatDiscoveryMemoryUsage(
  bytes: number | undefined,
): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "discovery=unavailable";
  }
  return `discovery=${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

/** Outcome of a {@link signalDiscoveryMemoryPressure} call. */
export interface DiscoveryMemoryPressureSignal {
  /** The heap/RSS sample the decision was made on. */
  readonly sample: HeapGuardSample;
  /** Whether the sample warranted cancelling an in-flight analysis. */
  readonly shouldCancel: boolean;
  /** Whether the cancellation actually reached Discovery over FFI. */
  readonly cancelled: boolean;
  /** Discovery-reported allocator footprint, when observable. */
  readonly usageBytes?: number;
}

/**
 * Samples host memory and, when the host is under genuine pressure, asks
 * NEAT-AI-Discovery to abort its in-flight analysis.
 *
 * Called from the evolve loop (the host isolate), which is *not* the isolate
 * blocked inside `analyze_parallel`; Discovery's cancellation flag is
 * process-wide, so this is the only way an in-flight analysis can be stopped
 * before it exhausts memory.
 *
 * Emits one grep-friendly `[DiscoveryMemory]` line per cancellation, carrying
 * the Discovery-reported usage bytes alongside the host heap/RSS numbers so
 * the two footprints can be compared in a single log entry. When the FFI
 * surface is unavailable the failure is reported explicitly rather than being
 * reported as a successful cancellation.
 */
export function signalDiscoveryMemoryPressure(
  memoryConfig: RequiredMemoryConfig,
  logger: Logger,
  deps?: DiscoveryAnalysisMemoryDeps,
  provider?: MemoryUsageProvider,
): DiscoveryMemoryPressureSignal {
  const ffi = deps ?? DEFAULT_DISCOVERY_ANALYSIS_MEMORY_DEPS;
  const sample = sampleHeapPressure(memoryConfig, provider);
  const shouldCancel = shouldCancelAnalysisForMemoryPressure(
    sample,
    memoryConfig,
  );
  if (!shouldCancel) {
    return { sample, shouldCancel: false, cancelled: false };
  }

  const usageBytes = ffi.usageBytes();
  const cancelled = ffi.cancelMemoryPressure();
  const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  const state = `heap=${mb(sample.heapUsed)}/${mb(sample.heapTotal)} rss=${
    mb(sample.rss)
  } ${formatDiscoveryMemoryUsage(usageBytes)}`;

  if (cancelled) {
    logger.warn(
      `[DiscoveryMemory] Host memory pressure (${sample.pressureLevel}) — ` +
        `cancelled in-flight discovery analysis [${state}]`,
    );
  } else {
    logger.warn(
      `[DiscoveryMemory] Host memory pressure (${sample.pressureLevel}) but ` +
        `cancel_analysis_memory_pressure is unavailable — in-flight analysis ` +
        `will run to completion [${state}]`,
    );
  }

  return {
    sample,
    shouldCancel: true,
    cancelled,
    ...(usageBytes === undefined ? {} : { usageBytes }),
  };
}
