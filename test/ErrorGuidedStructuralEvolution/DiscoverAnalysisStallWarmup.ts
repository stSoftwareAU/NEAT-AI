/**
 * Tests for the throughput-stall warm-up gate and rate-of-change check
 * (Issue #2513).
 *
 * Background: Issue #2380 added a per-chunk stall guard that aborted the
 * retry loop when a single Rust FFI chunk exceeded `perChunkMaxMs`. In
 * production this fired after only the first chunk (the warm-up chunk that
 * pays for parquet loading, GPU initialisation, and module dispatch),
 * tearing down the entire retry loop after evaluating just 6 neurons.
 *
 * The fix:
 *
 *   1. Defer the per-chunk stall guard until a warm-up budget has been
 *      spent (a minimum of two completed chunks).
 *   2. Once warm-up has elapsed, the average per-chunk elapsed must still
 *      exceed the per-chunk budget — a slow first chunk amortised by a
 *      fast second chunk must NOT abort.
 *   3. Surface heap / RSS state on the abort log line so future stalls can
 *      be correlated with memory pressure.
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
  formatStallMemoryDiagnostics,
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

interface SpyOptions {
  readonly analyzeParallel: (
    input: RustParallelAnalysisInput,
  ) => ReturnType<DiscoverStructureDeps["analyzeParallel"]>;
  readonly analysisChunkSize: number;
  readonly perChunkMaxMs: number;
  readonly discoveryMaxNeurons?: number;
  readonly now?: () => number;
  readonly perChunkGraceMs?: number;
}

async function runWith(
  options: SpyOptions,
): Promise<{
  capturedFocusSizes: number[];
  perfStats: DiscoveryPerformanceStats;
}> {
  await initWasmForTests();

  const creature = makeTestCreature();
  const capturedFocusSizes: number[] = [];

  const tempParquetPath = await Deno.makeTempFile({
    prefix: "discover-analysis-stall-warmup-",
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
      return options.analyzeParallel(input);
    },
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

  try {
    await runAnalysisLoop(
      {
        ID: "T-2513",
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
      // ignore
    }
  }

  return { capturedFocusSizes, perfStats };
}

Deno.test(
  "warm-up gate: a single slow first chunk does NOT trip iterationStalled",
  async () => {
    // Drive the loop with an explicit mock clock that only advances when
    // analyzeParallel is invoked. Chunk 1 simulates a slow warm-up call;
    // subsequent chunks return promptly. With the warm-up gate in place
    // the slow first chunk must NOT abort the retry loop.
    let tick = 1_000_000;
    const fakeNow = () => tick;
    const chunkDurationsMs = [5_000, 1, 1, 1];
    let chunkCallIdx = 0;

    const { perfStats } = await runWith({
      analyzeParallel: () => {
        const dur = chunkDurationsMs[chunkCallIdx++] ?? 1;
        tick += dur;
        return {
          success: true,
          helpfulNeurons: [],
          helpfulSynapses: [],
          harmfulSynapses: [],
        };
      },
      analysisChunkSize: 1,
      perChunkMaxMs: 100,
      discoveryMaxNeurons: 6,
      now: fakeNow,
    });

    assertFalse(
      perfStats.analysisStalled,
      "warm-up chunk overshoot must not trip analysisStalled when subsequent chunks are fast",
    );
  },
);

Deno.test(
  "warm-up gate: sustained slow chunks past warm-up DO trip iterationStalled",
  async () => {
    // Fake clock that advances 5_000ms on every read — every chunk will
    // appear to take much longer than the 100ms per-chunk budget. After the
    // warm-up window passes, the stall guard MUST fire.
    let tick = 1_000_000;
    const advanceNow = () => {
      tick += 5_000;
      return tick;
    };

    const { perfStats } = await runWith({
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

    assert(
      perfStats.analysisStalled,
      "sustained per-chunk overshoot past warm-up must set analysisStalled",
    );
  },
);

Deno.test(
  "warm-up gate: stall guard never fires when chunks complete within budget",
  async () => {
    const { perfStats } = await runWith({
      analyzeParallel: () => ({
        success: true,
        helpfulNeurons: [],
        helpfulSynapses: [],
        harmfulSynapses: [],
      }),
      analysisChunkSize: 2,
      perChunkMaxMs: 60_000,
      discoveryMaxNeurons: 6,
    });

    assertFalse(
      perfStats.analysisStalled,
      "all-fast chunks must never trip analysisStalled",
    );
  },
);

Deno.test(
  "deadline exhaustion between chunks is NOT reported as a throughput stall (GRQ #2312)",
  async () => {
    // Drive the loop so the warm-up chunk consumes the entire analysis
    // budget. After chunk 1 returns the inner loop's between-chunks deadline
    // check (chunkTimeRemaining <= 0) fires. Pre-fix this set
    // `iterationStalled = true` and emitted the misleading
    // "analysis throughput stalled after evaluating N neuron(s)" line. After
    // GRQ #2312 the deadline path just breaks out of the inner chunk loop and
    // the outer loop emits "analysis timeout reached" instead — so the
    // surfaced `perfStats.analysisStalled` must stay false.
    let tick = 1_000_000;
    const fakeNow = () => tick;
    // Burn 11 minutes on the first chunk so the 10-minute analysis deadline
    // (configured inside runWith) is exhausted before chunk 2 is submitted.
    const chunkDurationsMs = [11 * 60 * 1000, 1, 1, 1, 1, 1];
    let chunkCallIdx = 0;

    const { perfStats } = await runWith({
      analyzeParallel: () => {
        const dur = chunkDurationsMs[chunkCallIdx++] ?? 1;
        tick += dur;
        return {
          success: true,
          helpfulNeurons: [],
          helpfulSynapses: [],
          harmfulSynapses: [],
        };
      },
      analysisChunkSize: 1,
      // Use a generous per-chunk budget so the per-chunk stall guard does NOT
      // fire — only the overall deadline does.
      perChunkMaxMs: 30 * 60 * 1000,
      discoveryMaxNeurons: 6,
      now: fakeNow,
    });

    assertFalse(
      perfStats.analysisStalled,
      "overall-deadline exhaustion between chunks must NOT be reported as a throughput stall",
    );
  },
);

Deno.test(
  "formatStallMemoryDiagnostics returns a non-empty diagnostic string",
  () => {
    const text = formatStallMemoryDiagnostics();
    // The function must produce something useful so the abort log can be
    // correlated with memory pressure.
    assert(
      typeof text === "string" && text.length > 0,
      "formatStallMemoryDiagnostics must return a non-empty string",
    );
    // The diagnostic should include heap and rss labels.
    assert(
      /heap=/i.test(text),
      `expected diagnostic to mention heap, got: ${text}`,
    );
    assert(
      /rss=/i.test(text),
      `expected diagnostic to mention rss, got: ${text}`,
    );
  },
);
