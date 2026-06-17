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
import { checkAnalysisHeapAbort } from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";

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
