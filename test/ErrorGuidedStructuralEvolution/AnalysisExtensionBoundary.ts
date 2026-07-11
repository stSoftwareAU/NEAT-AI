/**
 * Unit tests for the analysis-extension boundary helpers (Issue #3027).
 *
 * `buildEmptyDiscoverResult` is the single source of truth for the empty
 * `DiscoverResult` shape returned by every early-return branch in
 * `DataRecorder`; `resolveHeapAbortBoundary` makes the off-heap-aware abort
 * decision. These tests pin the contract directly; the wire-level end-to-end
 * behaviour is covered by `DiscoveryHeapAbortBoundaryIntegration.ts`.
 */
import { assert, assertEquals } from "@std/assert";
import {
  buildEmptyDiscoverResult,
  resolveDegradedAnalysisBoundary,
  resolveHeapAbortBoundary,
} from "@architecture/ErrorGuidedStructuralEvolution/AnalysisExtensionBoundary.ts";
import { DEFAULT_MEMORY_CONFIG } from "@config/MemoryConfig.ts";
import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import type { Logger } from "@utils/Logger.ts";
import type { MemoryUsageSample } from "@neat/MemoryMonitor.ts";

const MB = 1024 * 1024;

function noopLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function provider(sample: MemoryUsageSample): () => MemoryUsageSample {
  return () => sample;
}

Deno.test("buildEmptyDiscoverResult: every candidate field is undefined, no heap flag", () => {
  const result = buildEmptyDiscoverResult("disc-1");
  assertEquals(result.ID, "disc-1");
  assertEquals(result.addHelpfulSynapses, undefined);
  assertEquals(result.addHelpfulNeurons, undefined);
  assertEquals(result.coordinatedStructuralCandidates, undefined);
  assertEquals(result.removeHarmfulSynapse, undefined);
  assertEquals(result.removeHarmfulNeurons, undefined);
  assertEquals(result.removalCandidates, undefined);
  assertEquals(result.candidateSquashes, undefined);
  // The flag must be absent (not `false`) so happy-path wire shapes match.
  assertEquals(result.heapAbortedAtExtensionBoundary, undefined);
  assert(!("heapAbortedAtExtensionBoundary" in result));
});

Deno.test("buildEmptyDiscoverResult: heap-abort option sets the structured flag", () => {
  const result = buildEmptyDiscoverResult("disc-2", {
    heapAbortedAtExtensionBoundary: true,
  });
  assertEquals(result.heapAbortedAtExtensionBoundary, true);
});

Deno.test("buildEmptyDiscoverResult: heap-abort option false leaves the flag unset", () => {
  const result = buildEmptyDiscoverResult("disc-3", {
    heapAbortedAtExtensionBoundary: false,
  });
  assertEquals(result.heapAbortedAtExtensionBoundary, undefined);
});

Deno.test("resolveHeapAbortBoundary: returns null when heap is not critical", () => {
  const decision = resolveHeapAbortBoundary(
    "disc-4",
    DEFAULT_MEMORY_CONFIG,
    noopLogger(),
    provider({ heapUsed: 50 * MB, heapTotal: 269 * MB }), // ≈0.19, normal
  );
  assertEquals(decision, null);
});

Deno.test("resolveHeapAbortBoundary: returns aborted result on legacy CRITICAL (no native budget)", () => {
  const decision = resolveHeapAbortBoundary(
    "disc-5",
    DEFAULT_MEMORY_CONFIG, // nativeBudgetBytes = 0
    noopLogger(),
    provider({ heapUsed: 231 * MB, heapTotal: 269 * MB }), // ≈0.86, critical
  );
  assert(decision !== null);
  assertEquals(decision?.heapAbortedAtExtensionBoundary, true);
  assertEquals(decision?.ID, "disc-5");
});

Deno.test("resolveHeapAbortBoundary: native-budget headroom suppresses the abort despite CRITICAL V8 fraction", () => {
  const config: RequiredMemoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    nativeBudgetBytes: 20 * 1024 * MB,
  };
  const decision = resolveHeapAbortBoundary(
    "disc-6",
    config,
    noopLogger(),
    provider({
      heapUsed: 231 * MB,
      heapTotal: 269 * MB, // ≈0.86, critical V8 fraction
      rss: 8 * 1024 * MB, // within the 20 GB native budget
      external: 47 * MB,
    }),
  );
  assertEquals(decision, null);
});

Deno.test("resolveHeapAbortBoundary: monitoring disabled never aborts", () => {
  const config: RequiredMemoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    enabled: false,
  };
  const decision = resolveHeapAbortBoundary(
    "disc-7",
    config,
    noopLogger(),
    provider({ heapUsed: 260 * MB, heapTotal: 269 * MB }), // would be critical
  );
  assertEquals(decision, null);
});

function capturingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (...args: unknown[]) => warnings.push(args.join(" ")),
      error: () => {},
    },
    warnings,
  };
}

Deno.test("resolveDegradedAnalysisBoundary: not critical returns the current knobs unchanged (happy path)", () => {
  const { logger, warnings } = capturingLogger();
  const decision = resolveDegradedAnalysisBoundary(
    "disc-8",
    DEFAULT_MEMORY_CONFIG,
    logger,
    { discoveryMaxNeurons: 16, analysisChunkSize: 32 },
    provider({ heapUsed: 50 * MB, heapTotal: 269 * MB }), // ≈0.19, normal
  );
  assertEquals(decision.degraded, false);
  assertEquals(decision.knobs.discoveryMaxNeurons, 16);
  assertEquals(decision.knobs.analysisChunkSize, 32);
  assertEquals(decision.reason, undefined);
  assertEquals(warnings.length, 0);
});

Deno.test("resolveDegradedAnalysisBoundary: CRITICAL heap degrades and continues instead of aborting", () => {
  const { logger, warnings } = capturingLogger();
  const decision = resolveDegradedAnalysisBoundary(
    "disc-9",
    DEFAULT_MEMORY_CONFIG, // legacy CRITICAL (no native budget) → would-abort
    logger,
    { discoveryMaxNeurons: 16, analysisChunkSize: 32 },
    provider({ heapUsed: 231 * MB, heapTotal: 269 * MB }), // ≈0.86, critical
  );
  assertEquals(decision.degraded, true);
  // Footprint reduced — analysis continues at the minimal footprint.
  assert(decision.knobs.discoveryMaxNeurons < 16);
  assert(decision.knobs.analysisChunkSize < 32);
  // The degrade decision is logged with the reduced knob values.
  assertEquals(warnings.length, 1);
  assert(warnings[0].includes("DEGRADED at extension boundary"));
  assert(warnings[0].includes("maxNeurons 16->"));
  assert(warnings[0].includes("chunkSize 32->"));
});

Deno.test("resolveDegradedAnalysisBoundary: genuine budget exhaustion degrades (no OOM-forcing abort)", () => {
  // RSS over the native budget — the previous behaviour aborted to zero
  // candidates. #3296 degrades to the minimal footprint and continues.
  const config: RequiredMemoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    nativeBudgetBytes: 8 * 1024 * MB,
  };
  const { logger } = capturingLogger();
  const decision = resolveDegradedAnalysisBoundary(
    "disc-10",
    config,
    logger,
    { discoveryMaxNeurons: 12, analysisChunkSize: 0 },
    provider({
      heapUsed: 231 * MB,
      heapTotal: 269 * MB,
      rss: 9 * 1024 * MB, // over the 8 GB budget — genuine exhaustion
      external: 47 * MB,
    }),
  );
  assertEquals(decision.degraded, true);
  assert(decision.knobs.discoveryMaxNeurons < 12);
});
