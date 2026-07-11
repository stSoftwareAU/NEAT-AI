/**
 * Unit tests for the degrade-and-continue knob decision (Issue #3296).
 *
 * `computeDegradedAnalysisKnobs` is the single source of truth for the minimal
 * analysis footprint used both at the CRITICAL-heap extension boundary and when
 * a host is memory-starved at the start of a discovery run. These tests pin the
 * reduction rules, the floors, and the observable reason string.
 */
import { assert, assertEquals } from "@std/assert";
import {
  computeDegradedAnalysisKnobs,
  DEGRADED_ANALYSIS_CHUNK_SIZE,
  MIN_DEGRADED_MAX_NEURONS,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisDegradeDecision.ts";

Deno.test("computeDegradedAnalysisKnobs: reduces focus breadth to a quarter and bounds chunk size", () => {
  const decision = computeDegradedAnalysisKnobs({
    discoveryMaxNeurons: 16,
    analysisChunkSize: 32,
  });
  assertEquals(decision.knobs.discoveryMaxNeurons, 4); // ceil(16 * 0.25)
  assertEquals(decision.knobs.analysisChunkSize, DEGRADED_ANALYSIS_CHUNK_SIZE);
  // Both knobs reduced — the reason names each with from->to.
  assertEquals(decision.reductions.length, 2);
  assert(decision.reason.includes("maxNeurons 16->4"));
  assert(decision.reason.includes("chunkSize 32->4"));
});

Deno.test("computeDegradedAnalysisKnobs: an unbounded chunk size is bounded to the degraded chunk", () => {
  const decision = computeDegradedAnalysisKnobs({
    discoveryMaxNeurons: 12,
    analysisChunkSize: 0, // whole focus list in one FFI call
  });
  assertEquals(decision.knobs.analysisChunkSize, DEGRADED_ANALYSIS_CHUNK_SIZE);
  assert(decision.reason.includes("chunkSize unbounded->4"));
});

Deno.test("computeDegradedAnalysisKnobs: focus breadth never drops below one neuron", () => {
  const decision = computeDegradedAnalysisKnobs({
    discoveryMaxNeurons: 1,
    analysisChunkSize: 1,
  });
  assertEquals(decision.knobs.discoveryMaxNeurons, MIN_DEGRADED_MAX_NEURONS);
  // Already minimal — nothing to reduce.
  assertEquals(decision.reductions.length, 0);
  assertEquals(decision.reason, "already at minimal footprint");
});

Deno.test("computeDegradedAnalysisKnobs: an already-small chunk size is left untouched", () => {
  const decision = computeDegradedAnalysisKnobs({
    discoveryMaxNeurons: 8,
    analysisChunkSize: 2,
  });
  assertEquals(decision.knobs.analysisChunkSize, 2);
  // Only the focus breadth was reduced.
  assertEquals(decision.reductions.length, 1);
  assertEquals(decision.reductions[0].knob, "maxNeurons");
});

Deno.test("computeDegradedAnalysisKnobs: starved-at-start large host yields a minimal footprint", () => {
  // A starved host starting analysis with a wide breadth degrades to the
  // minimal footprint immediately rather than deferring.
  const decision = computeDegradedAnalysisKnobs({
    discoveryMaxNeurons: 40,
    analysisChunkSize: 64,
  });
  assert(decision.knobs.discoveryMaxNeurons < 40);
  assert(decision.knobs.discoveryMaxNeurons >= MIN_DEGRADED_MAX_NEURONS);
  assertEquals(decision.knobs.analysisChunkSize, DEGRADED_ANALYSIS_CHUNK_SIZE);
});

Deno.test("computeDegradedAnalysisKnobs: non-finite inputs fall back to the minimal footprint", () => {
  const decision = computeDegradedAnalysisKnobs({
    discoveryMaxNeurons: Number.NaN,
    analysisChunkSize: Number.NaN,
  });
  assertEquals(decision.knobs.discoveryMaxNeurons, MIN_DEGRADED_MAX_NEURONS);
  assertEquals(decision.knobs.analysisChunkSize, DEGRADED_ANALYSIS_CHUNK_SIZE);
});
