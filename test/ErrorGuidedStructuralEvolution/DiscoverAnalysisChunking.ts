/**
 * Tests for chunked Rust combined-analysis with adaptive throughput
 * early-exit (Issue #2380).
 *
 * These tests verify that the analysis loop:
 * 1. Splits the focus list into chunks of `analysisChunkSize` neurons so
 *    each Rust FFI call is bounded in scope.
 * 2. Aborts the loop when a single chunk exceeds `perChunkMaxMs` — the
 *    "throughput stalled" adaptive early-exit required by the issue.
 * 3. Records the stall in `DiscoveryPerformanceStats.analysisStalled`.
 * 4. Falls back to a single unbatched call when chunking is disabled
 *    (backwards-compatible path).
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import { PhaseDiagnostics } from "@architecture/ErrorGuidedStructuralEvolution/PhaseDiagnostics.ts";
import {
  chunkFocusList,
  runAnalysisLoop,
} from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { RustParallelAnalysisInput } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        uuid: "hidden-a",
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        uuid: "hidden-b",
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        uuid: "hidden-c",
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        uuid: "output-0",
        type: "output",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.25 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: -0.5 },
      { fromUUID: "input-1", toUUID: "hidden-c", weight: 0.75 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: -0.25 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeTrainingData(): DataRecordInterface[] {
  const samples: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push({
      input: Float32Array.from([i / 20, (i + 1) / 20]),
      output: Float32Array.from([i / 10]),
    });
  }
  return samples;
}

interface SpyRunOptions {
  readonly analyzeParallel: (
    input: RustParallelAnalysisInput,
  ) => ReturnType<DiscoverStructureDeps["analyzeParallel"]>;
  readonly analysisChunkSize: number;
  readonly perChunkMaxMs: number;
  readonly discoveryMaxNeurons?: number;
  readonly now?: () => number;
  readonly perChunkGraceMs?: number;
}

interface CapturedCall {
  readonly focusSize: number;
  readonly analysisDeadlineMs: number | undefined;
  readonly capturedAtMs: number;
}

async function runWithMockedAnalyzeParallel(
  options: SpyRunOptions,
): Promise<{
  capturedFocusSizes: number[];
  capturedCalls: CapturedCall[];
  perfStats: DiscoveryPerformanceStats;
}> {
  await initWasmForTests();

  const creature = makeTestCreature();
  const capturedFocusSizes: number[] = [];
  const capturedCalls: CapturedCall[] = [];
  const nowFn = options.now ?? Date.now;

  // Create a real on-disk "parquet" stand-in so the existence check in
  // loadNeuronRecords passes. The mocked readDiscoveryRecords returns an
  // empty record set, so the content of the file is irrelevant.
  const tempParquetPath = await Deno.makeTempFile({
    prefix: "discover-analysis-chunking-",
    suffix: ".parquet",
  });

  const deps: Partial<DiscoverStructureDeps> = {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: tempParquetPath }),
    mergeDiscoveryParquet: () => ({
      success: true,
      outputFile: tempParquetPath,
    }),
    analyzeParallel: (input) => {
      capturedFocusSizes.push(input.focusNeurons.length);
      capturedCalls.push({
        focusSize: input.focusNeurons.length,
        analysisDeadlineMs: input.analysisDeadlineMs,
        capturedAtMs: nowFn(),
      });
      return options.analyzeParallel(input);
    },
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };

  const structure = new DiscoverStructure(creature, 600, 100, deps);
  const neuronPromises = new Map<number, Promise<void>>();
  structure.initialize(neuronPromises);

  // Force a parquetFilePath so ensureRustCombinedAnalysis proceeds.
  structure.record(makeTrainingData(), neuronPromises);
  structure.flushRustRecording();

  const config = createNeatConfig({
    discoveryAnalysisTimeoutMinutes: 10,
    discoveryMaxNeurons: options.discoveryMaxNeurons ?? 6,
    discoveryAnalysisChunkSize: options.analysisChunkSize,
    discoveryAnalysisPerChunkMaxMs: options.perChunkMaxMs,
  });

  const perfStats = new DiscoveryPerformanceStats();
  const phaseDiagnostics = new PhaseDiagnostics("analysis");

  const deadlineMs = (options.now ?? Date.now)() + 10 * 60 * 1000;
  // Give the DiscoverStructure a matching deadline
  structure.extendTimeoutForAnalysis(600);

  try {
    await runAnalysisLoop(
      {
        ID: "T-2380",
        config,
        discoveryMaxNeurons: options.discoveryMaxNeurons ?? 6,
        costOfGrowth: 0,
        analysisChunkSize: options.analysisChunkSize,
        perChunkMaxMs: options.perChunkMaxMs,
        perChunkGraceMs: options.perChunkGraceMs,
        now: options.now,
        getTimeoutTS: () => deadlineMs,
        refreshAnalysisTimeout: () => {},
      },
      structure,
      perfStats,
      phaseDiagnostics,
    );
  } finally {
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // Ignore cleanup failures
    }
  }

  return { capturedFocusSizes, capturedCalls, perfStats };
}

Deno.test("chunkFocusList splits into fixed-size sublists", () => {
  assertEquals(chunkFocusList([1, 2, 3, 4, 5, 6], 2), [[1, 2], [3, 4], [5, 6]]);
  assertEquals(chunkFocusList([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunkFocusList([1, 2, 3], 1), [[1], [2], [3]]);
});

Deno.test("chunkFocusList treats chunkSize<=0 as chunking-disabled", () => {
  assertEquals(chunkFocusList([1, 2, 3], 0), [[1, 2, 3]]);
  assertEquals(chunkFocusList([1, 2, 3], -5), [[1, 2, 3]]);
});

Deno.test("chunkFocusList returns [] for empty input", () => {
  assertEquals(chunkFocusList([], 4), []);
});

Deno.test("runAnalysisLoop submits the focus list in chunks of analysisChunkSize", async () => {
  const { capturedFocusSizes } = await runWithMockedAnalyzeParallel({
    analyzeParallel: () => ({
      success: true,
      helpfulNeurons: [],
      helpfulSynapses: [],
      harmfulSynapses: [],
    }),
    analysisChunkSize: 2,
    perChunkMaxMs: 0, // disable stall guard
    discoveryMaxNeurons: 6,
  });

  assert(
    capturedFocusSizes.length >= 1,
    `analyzeParallel should be called at least once, got ${capturedFocusSizes.length}`,
  );
  for (const size of capturedFocusSizes) {
    assert(
      size <= 2,
      `each Rust FFI call must carry at most analysisChunkSize neurons (got ${size})`,
    );
    assert(size >= 1, "each chunk must have at least one neuron");
  }
});

Deno.test("runAnalysisLoop submits whole focus list in one call when chunking disabled", async () => {
  const { capturedFocusSizes } = await runWithMockedAnalyzeParallel({
    analyzeParallel: () => ({
      success: true,
      helpfulNeurons: [],
      helpfulSynapses: [],
      harmfulSynapses: [],
    }),
    analysisChunkSize: 0, // disabled
    perChunkMaxMs: 0,
    discoveryMaxNeurons: 6,
  });

  // With chunking disabled, each retry iteration should submit the whole
  // focus list in a single call (sizes > 1 expected on the first attempt).
  assert(
    capturedFocusSizes.some((size) => size > 1),
    `expected at least one batched call when chunking disabled, got sizes ${
      capturedFocusSizes.join(",")
    }`,
  );
});

Deno.test("runAnalysisLoop aborts retries when a single chunk exceeds perChunkMaxMs (stall guard)", async () => {
  // Fake clock that advances by 5_000ms every call — each chunk will appear
  // to take much longer than a 100ms per-chunk budget, so the very first
  // chunk should trip the stall guard.
  let tick = 1_000_000;
  const advanceNow = () => {
    tick += 5_000;
    return tick;
  };

  const { capturedFocusSizes, perfStats } = await runWithMockedAnalyzeParallel({
    analyzeParallel: () => ({
      success: true,
      helpfulNeurons: [],
      helpfulSynapses: [],
      harmfulSynapses: [],
    }),
    analysisChunkSize: 1,
    perChunkMaxMs: 100,
    discoveryMaxNeurons: 6,
    now: advanceNow,
  });

  // Stall guard should have fired; at most a small number of chunks
  // should have been submitted (one to trip the guard, and we break
  // out immediately afterwards).
  assert(
    capturedFocusSizes.length <= 2,
    `stall guard should abort further chunks, got ${capturedFocusSizes.length} calls`,
  );
  assert(
    perfStats.analysisStalled,
    "performance stats should record analysisStalled=true when stall guard trips",
  );
});

Deno.test("runAnalysisLoop forwards a tight per-chunk deadline to Rust (Issue #2501)", async () => {
  // Use a fake clock that does NOT advance, so the chunk start observed
  // inside the loop equals the time captured when analyzeParallel is invoked.
  // That lets us assert the deadline forwarded to Rust is exactly
  // chunkStart + perChunkMaxMs + grace, regardless of how long the overall
  // discovery analysis window is.
  const fixedTick = 5_000_000;
  const fakeNow = () => fixedTick;
  const perChunkMaxMs = 120_000; // 2 minutes — same shape as the production bug
  const perChunkGraceMs = 1_000;

  const { capturedCalls } = await runWithMockedAnalyzeParallel({
    analyzeParallel: () => ({
      success: true,
      helpfulNeurons: [],
      helpfulSynapses: [],
      harmfulSynapses: [],
    }),
    analysisChunkSize: 1,
    perChunkMaxMs,
    perChunkGraceMs,
    discoveryMaxNeurons: 6,
    now: fakeNow,
  });

  assert(
    capturedCalls.length >= 1,
    `expected at least one Rust analysis call, got ${capturedCalls.length}`,
  );
  for (const call of capturedCalls) {
    assert(
      call.analysisDeadlineMs !== undefined,
      "Rust analysis input must carry an analysisDeadlineMs when perChunkMaxMs > 0",
    );
    const expected = call.capturedAtMs + perChunkMaxMs + perChunkGraceMs;
    assertEquals(
      call.analysisDeadlineMs,
      expected,
      `per-chunk deadline forwarded to Rust must equal chunkStart + perChunkMaxMs + grace; got ${call.analysisDeadlineMs}, expected ${expected}`,
    );
  }
});

Deno.test("runAnalysisLoop omits per-chunk deadline tightening when stall guard disabled (Issue #2501)", async () => {
  const fixedTick = 5_000_000;
  const fakeNow = () => fixedTick;
  // 10-minute analysis window from the helper.
  const overallDeadlineMs = fixedTick + 10 * 60 * 1000;

  const { capturedCalls } = await runWithMockedAnalyzeParallel({
    analyzeParallel: () => ({
      success: true,
      helpfulNeurons: [],
      helpfulSynapses: [],
      harmfulSynapses: [],
    }),
    analysisChunkSize: 2,
    perChunkMaxMs: 0, // stall guard disabled
    discoveryMaxNeurons: 6,
    now: fakeNow,
  });

  assert(
    capturedCalls.length >= 1,
    "expected at least one Rust analysis call",
  );
  for (const call of capturedCalls) {
    // With perChunkMaxMs=0, no chunk-level tightening is applied; the overall
    // analysis deadline (or undefined) is forwarded to Rust unchanged.
    if (call.analysisDeadlineMs !== undefined) {
      assert(
        call.analysisDeadlineMs >= overallDeadlineMs - 1_000,
        `analysisDeadlineMs must not be tightened when perChunkMaxMs=0; got ${call.analysisDeadlineMs}, overall deadline ${overallDeadlineMs}`,
      );
    }
  }
});

Deno.test("runAnalysisLoop does not mark analysisStalled when all chunks finish within budget", async () => {
  const { perfStats } = await runWithMockedAnalyzeParallel({
    analyzeParallel: () => ({
      success: true,
      helpfulNeurons: [],
      helpfulSynapses: [],
      harmfulSynapses: [],
    }),
    analysisChunkSize: 2,
    // Large per-chunk budget so real elapsed time won't exceed it.
    perChunkMaxMs: 60_000,
    discoveryMaxNeurons: 6,
  });

  assertFalse(
    perfStats.analysisStalled,
    "analysisStalled must stay false when chunks complete within per-chunk budget",
  );
});
