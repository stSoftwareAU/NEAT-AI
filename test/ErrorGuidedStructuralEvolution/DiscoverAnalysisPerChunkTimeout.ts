/**
 * Tests for the mid-flight per-chunk timeout and the defence-in-depth
 * overall wall-clock cap introduced in Issue #2420.
 *
 * Background: Issue #2380 added a per-chunk budget, but the check only
 * fired AFTER `runParallelAnalysis` returned. A single Rust FFI chunk
 * could therefore burn the entire discovery budget before the JS side
 * noticed. These tests verify that:
 *
 * 1. `runParallelAnalysis` is raced against `perChunkMaxMs + grace` so a
 *    never-returning driver aborts mid-flight and sets `analysisStalled`.
 * 2. A defence-in-depth wall-clock cap of `perChunkMaxMs * chunks.length`
 *    prevents further chunks even when a chunk-sized stall is barely
 *    under the per-chunk budget on each individual call.
 */
import { assert, assertFalse } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import { PhaseDiagnostics } from "@architecture/ErrorGuidedStructuralEvolution/PhaseDiagnostics.ts";
import {
  type ParallelAnalysisFn,
  runAnalysisLoop,
} from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "hidden-c", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
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

interface RunOptions {
  readonly runParallelAnalysis: ParallelAnalysisFn;
  readonly analysisChunkSize: number;
  readonly perChunkMaxMs: number;
  readonly perChunkGraceMs?: number;
  readonly discoveryMaxNeurons?: number;
  readonly now?: () => number;
}

async function runAnalysisLoopWithStub(
  options: RunOptions,
): Promise<{ perfStats: DiscoveryPerformanceStats; callCount: number }> {
  await initWasmForTests();

  const creature = makeTestCreature();

  const tempParquetPath = await Deno.makeTempFile({
    prefix: "discover-analysis-timeout-",
    suffix: ".parquet",
  });

  // Force the fallback `runParallelAnalysis` branch by making the Rust
  // combined-analysis call report "no result" (null) — this causes
  // collectRustAnalysisCandidates() to return undefined so the loop
  // falls through to the parallel driver, which is stubbed by the caller.
  const deps: Partial<DiscoverStructureDeps> = {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: tempParquetPath }),
    mergeDiscoveryParquet: () => ({
      success: true,
      outputFile: tempParquetPath,
    }),
    analyzeParallel: () => null,
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };

  const structure = new DiscoverStructure(creature, 600, 100, deps);
  const neuronPromises = new Map<number, Promise<void>>();
  structure.initialize(neuronPromises);
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
  structure.extendTimeoutForAnalysis(600);

  let callCount = 0;
  const wrapped: ParallelAnalysisFn = (ctx, ds, ps, pd, focus) => {
    callCount++;
    return options.runParallelAnalysis(ctx, ds, ps, pd, focus);
  };

  try {
    await runAnalysisLoop(
      {
        ID: "T-2420",
        config,
        discoveryMaxNeurons: options.discoveryMaxNeurons ?? 6,
        costOfGrowth: 0,
        analysisChunkSize: options.analysisChunkSize,
        perChunkMaxMs: options.perChunkMaxMs,
        perChunkGraceMs: options.perChunkGraceMs,
        now: options.now,
        getTimeoutTS: () => deadlineMs,
        refreshAnalysisTimeout: () => {},
        runParallelAnalysis: wrapped,
        // Issue #2735: exercises the per-chunk timeout, not the heap guard; opt
        // out so the test process heap ratio does not trip the in-loop abort.
        heapCriticalProbe: () => false,
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

  return { perfStats, callCount };
}

Deno.test("runAnalysisLoop aborts runParallelAnalysis mid-flight when it never resolves", async () => {
  const { perfStats, callCount } = await runAnalysisLoopWithStub({
    // Stub driver that never resolves — simulates a hung Rust FFI call.
    runParallelAnalysis: () => new Promise(() => {}),
    analysisChunkSize: 1,
    perChunkMaxMs: 100,
    perChunkGraceMs: 50,
    discoveryMaxNeurons: 3,
  });

  // The observable outcome: the never-resolving driver was aborted mid-flight
  // and the stall was recorded. This is a WHAT-assertion — no wall-clock
  // measurement, so it cannot flake on a loaded CI runner or ARM-vs-x86 host.
  assert(
    perfStats.analysisStalled,
    "analysisStalled must be set when runParallelAnalysis times out mid-flight",
  );
  // The stub is invoked at most once per iteration before the timeout
  // aborts the chunk loop. One call is expected.
  assert(
    callCount >= 1,
    `expected runParallelAnalysis to be invoked at least once, got ${callCount}`,
  );
});

Deno.test("runAnalysisLoop records no stall when runParallelAnalysis resolves within budget", async () => {
  const { perfStats } = await runAnalysisLoopWithStub({
    runParallelAnalysis: () =>
      Promise.resolve([undefined, undefined, undefined, undefined, undefined]),
    analysisChunkSize: 2,
    perChunkMaxMs: 60_000,
    discoveryMaxNeurons: 6,
  });

  assertFalse(
    perfStats.analysisStalled,
    "analysisStalled must stay false when the parallel driver resolves within budget",
  );
});

Deno.test("runAnalysisLoop defence-in-depth cap aborts remaining chunks when iteration wall-clock exceeds perChunkMaxMs * chunks", async () => {
  // Fake clock advancing by 1500ms on every read. With perChunkMaxMs = 1000
  // and analysisChunkSize = 1 (expect 3 chunks from 3 hidden neurons), the
  // iteration cap is 3000ms. After a few clock reads, iteration elapsed
  // exceeds the cap and subsequent chunks must be skipped.
  let tick = 1_000_000;
  const advanceNow = () => {
    tick += 1_500;
    return tick;
  };

  const { perfStats, callCount } = await runAnalysisLoopWithStub({
    // Resolve immediately — stall isn't from the driver but from the clock.
    runParallelAnalysis: () =>
      Promise.resolve([undefined, undefined, undefined, undefined, undefined]),
    analysisChunkSize: 1,
    perChunkMaxMs: 1_000,
    discoveryMaxNeurons: 6,
    now: advanceNow,
  });

  assert(
    perfStats.analysisStalled,
    "analysisStalled must be set when the per-chunk stall guard or overall cap fires",
  );
  // The loop must NOT submit every chunk — at least one chunk is skipped
  // by the pre-flight cap or the per-chunk stall guard.
  assert(
    callCount < 3,
    `expected early abort to limit parallel calls, got ${callCount}`,
  );
});
