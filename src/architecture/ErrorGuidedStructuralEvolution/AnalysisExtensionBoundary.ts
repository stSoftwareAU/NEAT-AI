/**
 * Analysis-extension boundary result builder (Issue #3027).
 *
 * `DataRecorder.recordFiles()` returns an empty {@link DiscoverResult} in
 * three places — Rust unavailable, recording phase failed, and the heap-aware
 * extension guard abort. The shapes were duplicated inline; this module gives
 * a single source of truth so the empty-result contract (every candidate field
 * `undefined`) cannot drift between branches.
 *
 * Crucially it also exposes the heap-abort decision as one production function
 * ({@link resolveHeapAbortBoundary}) so the record→boundary→wire→outcome path
 * can be integration-tested end-to-end against real production code, rather
 * than re-implementing the rule in a test (Issue #3022 acceptance criteria).
 *
 * The decision delegates to {@link checkAnalysisHeapAbort}, which since Issue
 * #3025 is off-heap (RSS) aware: a worker-V8-only CRITICAL sample no longer
 * aborts while the configured native budget still has headroom. So the
 * `heapAbortedAtExtensionBoundary` signal is only set for a genuine
 * budget-exhaustion abort — exactly the false-positive this issue guards.
 *
 * @module
 */

import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import type { MemoryUsageProvider } from "@neat/MemoryMonitor.ts";
import type { Logger } from "@utils/Logger.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  checkAnalysisHeapAbort,
  type HeapGuardSample,
  sampleHeapPressure,
  shouldAbortOnHeapPressure,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import {
  type AnalysisKnobs,
  computeDegradedAnalysisKnobs,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisDegradeDecision.ts";

/** Options for {@link buildEmptyDiscoverResult}. */
export interface EmptyDiscoverResultOptions {
  /**
   * When `true`, marks the empty result as a heap-driven analysis-extension
   * abort so the upstream pipeline can emit `"heap_critical_skip"` rather than
   * `"no_change"` (Issue #2737). Omitted/`false` for the Rust-unavailable and
   * recording-failed branches.
   */
  heapAbortedAtExtensionBoundary?: boolean;
}

/**
 * Build the canonical empty {@link DiscoverResult}: every candidate field is
 * `undefined` because the analysis loop never produced candidates. Single
 * source of truth shared by every early-return branch in `DataRecorder`.
 *
 * @param ID - The discovery ID to echo back on the result.
 * @param options - Optional structured signals (e.g. the heap-abort flag).
 */
export function buildEmptyDiscoverResult(
  ID: string,
  options: EmptyDiscoverResultOptions = {},
): DiscoverResult {
  const result: DiscoverResult = {
    ID,
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };
  // Only attach the signal when explicitly requested so happy-path and
  // non-heap early returns leave the field `undefined` on the wire.
  if (options.heapAbortedAtExtensionBoundary) {
    result.heapAbortedAtExtensionBoundary = true;
  }
  return result;
}

/**
 * Make the analysis-extension boundary decision (Issue #2594/#2737/#3025).
 *
 * Samples the heap via {@link checkAnalysisHeapAbort} (the off-heap-aware
 * guard) and, when it aborts, returns the empty {@link DiscoverResult} carrying
 * `heapAbortedAtExtensionBoundary: true`. Returns `null` when analysis may
 * proceed — i.e. the guard did not abort, including the worker-default-heap
 * case where the V8 fraction is CRITICAL but the native budget still has
 * headroom. In that case the signal is left unset so downstream telemetry does
 * not mislabel a healthy iteration as `"heap_critical_skip"`.
 *
 * @param ID - The discovery ID (used for the result and the guard log line).
 * @param memoryConfig - Resolved memory config (thresholds + native budget).
 * @param logger - Logger for the guard's grep-friendly abort line.
 * @param provider - Optional injected heap sample source (tests).
 * @returns The abort result, or `null` to continue into analysis.
 */
export function resolveHeapAbortBoundary(
  ID: string,
  memoryConfig: RequiredMemoryConfig,
  logger: Logger,
  provider?: MemoryUsageProvider,
): DiscoverResult | null {
  const heapAbort = checkAnalysisHeapAbort(ID, memoryConfig, logger, provider);
  if (!heapAbort.abort) return null;
  return buildEmptyDiscoverResult(ID, {
    heapAbortedAtExtensionBoundary: true,
  });
}

/** Outcome of {@link resolveDegradedAnalysisBoundary}. */
export interface AnalysisBoundaryDecision {
  /**
   * `true` when the heap was CRITICAL at the boundary and analysis will run at a
   * degraded, minimal footprint instead of aborting to zero candidates.
   */
  degraded: boolean;
  /** The knobs analysis should run with (degraded when `degraded === true`). */
  knobs: AnalysisKnobs;
  /** The heap sample taken at the boundary. */
  sample: HeapGuardSample;
  /** Log-ready summary of the reduced knobs — set only when `degraded`. */
  reason?: string;
}

/**
 * Degrade-and-continue analysis-extension boundary decision (Issue #3296).
 *
 * Replaces the historical abort-to-zero-candidates behaviour: when the heap is
 * CRITICAL at the extension boundary, instead of returning an empty result the
 * boundary **degrades the analysis footprint** (fewer focus neurons, smaller
 * Rust FFI chunks — see {@link computeDegradedAnalysisKnobs}) and reports that
 * analysis should continue at that minimal footprint. The degrade decision is
 * logged with the reduced knob values so the smaller footprint is observable.
 *
 * When the heap is not CRITICAL the current knobs are returned unchanged and
 * `degraded` is `false` — the happy path is untouched.
 *
 * The same helper serves the "starved at start" case: passing the starting
 * knobs when the host is already memory-starved yields the minimal footprint to
 * begin analysis with, rather than deferring or skipping.
 *
 * @param ID - Discovery ID for the log line.
 * @param memoryConfig - Resolved memory config (thresholds + native budget).
 * @param logger - Logger for the grep-friendly degrade-decision line.
 * @param currentKnobs - The knobs analysis would otherwise run with.
 * @param provider - Optional injected heap sample source (tests).
 */
export function resolveDegradedAnalysisBoundary(
  ID: string,
  memoryConfig: RequiredMemoryConfig,
  logger: Logger,
  currentKnobs: AnalysisKnobs,
  provider?: MemoryUsageProvider,
): AnalysisBoundaryDecision {
  const sample = sampleHeapPressure(memoryConfig, provider);
  if (!shouldAbortOnHeapPressure(sample, memoryConfig)) {
    return { degraded: false, knobs: currentKnobs, sample };
  }

  const decision = computeDegradedAnalysisKnobs(currentKnobs);
  const heapPct = (sample.usageFraction * 100).toFixed(0);
  logger.warn(
    `[Neat] Discovery ${ID} analysis DEGRADED at extension boundary ` +
      `(heap CRITICAL ${heapPct}%): continuing at ${decision.reason} ` +
      `(#3296)`,
  );
  return {
    degraded: true,
    knobs: decision.knobs,
    sample,
    reason: decision.reason,
  };
}
