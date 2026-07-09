/**
 * Degrade-and-continue decision for the discovery analysis-extension boundary
 * (Issue #3296, part of GRQ #3267).
 *
 * When the heap is CRITICAL at the analysis-extension boundary the historical
 * response was to abort the iteration and return an empty {@link DiscoverResult}
 * with `heapAbortedAtExtensionBoundary: true` — a 0-candidate skip. The accepted
 * requirement is instead to **degrade the footprint and push through** so the
 * iteration reaches a genuine completion (candidates, or an honest
 * no-improvement result) rather than a 0-candidate abort.
 *
 * This module is a small, pure, side-effect-free helper that computes the
 * degraded analysis knobs from the current ones. It is deliberately independent
 * of the runtime so it can be unit-tested deterministically, and so the same
 * "minimal footprint" values are used both at the extension boundary and when a
 * host is memory-starved at the very start of a discovery run.
 *
 * @module
 */

/** The analysis-phase knobs that the degrade decision may reduce. */
export interface AnalysisKnobs {
  /** Focus breadth — neurons submitted to one analysis pass. */
  discoveryMaxNeurons: number;
  /**
   * Max neurons per Rust combined-analysis FFI call. `<= 0` means "whole focus
   * list in one call" (unbounded); reducing it bounds the peak FFI allocation.
   */
  analysisChunkSize: number;
}

/** A single knob that the degrade decision reduced. */
export interface KnobReduction {
  knob: string;
  /** Original value (`0` for an unbounded chunk size). */
  from: number;
  to: number;
}

/** Outcome of {@link computeDegradedAnalysisKnobs}. */
export interface DegradedAnalysisDecision {
  /** The degraded knobs to run analysis with. */
  knobs: AnalysisKnobs;
  /** The knobs that were actually reduced (empty when already minimal). */
  reductions: KnobReduction[];
  /**
   * Grep-friendly, human-readable summary of which knobs were reduced and to
   * what — logged so the reduced footprint is observable.
   */
  reason: string;
}

/**
 * Focus breadth is never degraded below this — at least one neuron must be
 * analysed so the pass reaches a genuine completion instead of skipping.
 */
export const MIN_DEGRADED_MAX_NEURONS = 1;

/**
 * Fraction of the current focus breadth kept when degrading. A quarter keeps a
 * meaningful (but much smaller) working set so candidates can still be found.
 */
export const DEGRADED_MAX_NEURONS_FACTOR = 0.25;

/**
 * Chunk size the degraded analysis bounds each Rust FFI call to. Small enough to
 * keep the peak combined-analysis allocation modest on a starved host, large
 * enough to make progress in a bounded number of calls.
 */
export const DEGRADED_ANALYSIS_CHUNK_SIZE = 4;

/** Coerce a value to a positive integer, or fall back when non-finite / <= 0. */
function positiveIntOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Compute the minimal-footprint analysis knobs to continue with under memory
 * pressure. Pure and deterministic: given the current knobs it returns the
 * degraded knobs, the list of reductions applied, and a log-ready reason.
 *
 * Rules:
 *  - Focus breadth (`discoveryMaxNeurons`) is reduced to a quarter, floored at
 *    {@link MIN_DEGRADED_MAX_NEURONS} so at least one neuron is always analysed.
 *  - Chunk size (`analysisChunkSize`) is bounded to
 *    {@link DEGRADED_ANALYSIS_CHUNK_SIZE}. An unbounded (`<= 0`) or larger chunk
 *    is reduced; an already-small chunk is left untouched.
 *  - A knob already at or below its degraded target is not listed as reduced.
 */
export function computeDegradedAnalysisKnobs(
  current: AnalysisKnobs,
): DegradedAnalysisDecision {
  const reductions: KnobReduction[] = [];

  // Focus breadth → quarter, floored so at least one neuron runs.
  const fromNeurons = positiveIntOr(
    current.discoveryMaxNeurons,
    MIN_DEGRADED_MAX_NEURONS,
  );
  const toNeurons = Math.max(
    MIN_DEGRADED_MAX_NEURONS,
    Math.min(fromNeurons, Math.ceil(fromNeurons * DEGRADED_MAX_NEURONS_FACTOR)),
  );
  if (toNeurons < fromNeurons) {
    reductions.push({ knob: "maxNeurons", from: fromNeurons, to: toNeurons });
  }

  // Chunk size → bounded small chunk. `0`/negative means unbounded (whole list).
  const fromChunkRaw = Number.isFinite(current.analysisChunkSize)
    ? Math.floor(current.analysisChunkSize)
    : 0;
  const fromChunk = fromChunkRaw > 0 ? fromChunkRaw : 0;
  let toChunk: number;
  if (fromChunk === 0 || fromChunk > DEGRADED_ANALYSIS_CHUNK_SIZE) {
    toChunk = DEGRADED_ANALYSIS_CHUNK_SIZE;
    reductions.push({ knob: "chunkSize", from: fromChunk, to: toChunk });
  } else {
    toChunk = fromChunk;
  }

  const reason = reductions.length > 0
    ? `minimal footprint: ${
      reductions
        .map((r) => `${r.knob} ${r.from === 0 ? "unbounded" : r.from}->${r.to}`)
        .join(", ")
    }`
    : "already at minimal footprint";

  return {
    knobs: { discoveryMaxNeurons: toNeurons, analysisChunkSize: toChunk },
    reductions,
    reason,
  };
}
