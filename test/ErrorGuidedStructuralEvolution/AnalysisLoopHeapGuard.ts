/**
 * Tests for the in-loop heap-critical guard in `runAnalysisLoop` (Issue #2735).
 *
 * Background: Issue #2594 added `AnalysisHeapGuard`, which samples the heap
 * once at the analysis-extension boundary and skips the extension when heap
 * is already CRITICAL. However, once analysis is under way, `runAnalysisLoop`
 * processes many chunks across up to ten retry iterations with no further
 * heap check. With a large layered seed (e.g. 986 neurons / ~109k synapses
 * over a ~60k-record supervised `.bin` stream) the per-chunk squash analysis
 * allocates aggressively (Issue #2642), so heap can climb back to CRITICAL
 * mid-loop and fatally OOM the worker.
 *
 * The fix: sample heap pressure at the start of each retry iteration and
 * before each chunk submission. When CRITICAL, abort the loop gracefully,
 * returning whatever candidates have accumulated so far and recording
 * `perfStats.analysisHeapAborted = true`, instead of pressing on into OOM.
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
import { runAnalysisLoop } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts";
import { _setHeapGuardProviderForTests } from "@architecture/ErrorGuidedStructuralEvolution/AnalysisHeapGuard.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { MemoryUsageSample } from "@neat/MemoryMonitor.ts";
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
  /** Heap sample returned by the injected provider for every check. */
  readonly heapSample: MemoryUsageSample;
  /** Whether heap monitoring is enabled in the config. */
  readonly memoryEnabled?: boolean;
  /** Off-heap (RSS) budget in bytes — Issue #3025. 0/undefined disables it. */
  readonly nativeBudgetBytes?: number;
  /**
   * Degrade-and-continue signal (Issue #3296): when true, the boundary degraded
   * under memory pressure, so the loop must run one minimal-footprint pass to a
   * genuine completion instead of aborting to zero candidates.
   */
  readonly degradedFirstPass?: boolean;
}

async function runWith(
  options: RunOptions,
): Promise<{ perfStats: DiscoveryPerformanceStats; chunkCalls: number }> {
  await initWasmForTests();

  const creature = makeTestCreature();
  let chunkCalls = 0;

  const tempParquetPath = await Deno.makeTempFile({
    prefix: "analysis-loop-heap-guard-",
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
      chunkCalls += input.focusNeurons.length > 0 ? 1 : 0;
      return {
        success: true,
        helpfulNeurons: [],
        helpfulSynapses: [],
        harmfulSynapses: [],
      };
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
    discoveryMaxNeurons: 6,
    discoveryAnalysisChunkSize: 1,
    discoveryAnalysisPerChunkMaxMs: 60_000,
    memory: {
      enabled: options.memoryEnabled ?? true,
      nativeBudgetBytes: options.nativeBudgetBytes ?? 0,
    },
  });

  const perfStats = new DiscoveryPerformanceStats();
  const phaseDiagnostics = new PhaseDiagnostics("analysis");
  const deadlineMs = Date.now() + 10 * 60 * 1000;
  structure.extendTimeoutForAnalysis(600);

  _setHeapGuardProviderForTests(() => options.heapSample);
  try {
    await runAnalysisLoop(
      {
        ID: "T-2735",
        config,
        discoveryMaxNeurons: 6,
        costOfGrowth: 0,
        analysisChunkSize: 1,
        perChunkMaxMs: 60_000,
        getTimeoutTS: () => deadlineMs,
        refreshAnalysisTimeout: () => {},
        degradedFirstPass: options.degradedFirstPass,
      },
      structure,
      perfStats,
      phaseDiagnostics,
    );
  } finally {
    _setHeapGuardProviderForTests(undefined);
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // ignore
    }
  }

  return { perfStats, chunkCalls };
}

Deno.test(
  "in-loop heap guard: CRITICAL heap aborts the analysis loop before any chunk runs",
  async () => {
    const { perfStats, chunkCalls } = await runWith({
      heapSample: { heapUsed: 95, heapTotal: 100 },
    });

    assert(
      perfStats.analysisHeapAborted,
      "CRITICAL heap must set perfStats.analysisHeapAborted",
    );
    assertFalse(
      perfStats.analysisStalled,
      "a heap abort is not a throughput stall",
    );
    assertEquals(
      chunkCalls,
      0,
      "no chunk should be submitted once heap is CRITICAL",
    );
    assertEquals(
      perfStats.neuronsAnalyzed,
      0,
      "no neurons analysed when aborting before the first chunk",
    );
  },
);

Deno.test(
  "degrades footprint and continues at extension boundary instead of aborting",
  async () => {
    // Same persistently-CRITICAL heap as the abort-to-zero case above, but the
    // boundary degraded (degradedFirstPass = true). The loop must run one
    // minimal-footprint pass to a genuine completion instead of aborting with
    // zero neurons analysed (Issue #3296).
    const { perfStats, chunkCalls } = await runWith({
      heapSample: { heapUsed: 95, heapTotal: 100 }, // CRITICAL
      degradedFirstPass: true,
    });

    assert(
      chunkCalls > 0,
      "degraded first pass must submit at least one analysis chunk (no 0-candidate abort)",
    );
    assert(
      perfStats.neuronsAnalyzed > 0,
      "degraded first pass must analyse neurons rather than skip to zero",
    );
  },
);

Deno.test(
  "in-loop heap guard: normal heap runs the loop without aborting",
  async () => {
    const { perfStats, chunkCalls } = await runWith({
      heapSample: { heapUsed: 10, heapTotal: 100 },
    });

    assertFalse(
      perfStats.analysisHeapAborted,
      "normal heap must not trip the heap-abort guard",
    );
    assert(
      chunkCalls > 0,
      "chunks should run normally when heap is not under pressure",
    );
  },
);

Deno.test(
  "in-loop heap guard: V8-only CRITICAL within native budget keeps the loop running (#3025)",
  async () => {
    const MB = 1024 * 1024;
    const { perfStats, chunkCalls } = await runWith({
      // V8 heap ≈86% (CRITICAL) but RSS well within the configured budget.
      heapSample: {
        heapUsed: Math.round(231 * MB),
        heapTotal: Math.round(269 * MB),
        rss: Math.round(13289 * MB),
        external: Math.round(47 * MB),
      },
      nativeBudgetBytes: Math.round(16384 * MB),
    });

    assertFalse(
      perfStats.analysisHeapAborted,
      "off-heap headroom must keep the loop running despite V8 CRITICAL",
    );
    assert(
      chunkCalls > 0,
      "chunks should run when only the V8 fraction is critical but RSS is within budget",
    );
  },
);

Deno.test(
  "in-loop heap guard: RSS over native budget still aborts (#3025)",
  async () => {
    const MB = 1024 * 1024;
    const budget = Math.round(16384 * MB);
    const { perfStats, chunkCalls } = await runWith({
      heapSample: {
        heapUsed: Math.round(231 * MB),
        heapTotal: Math.round(269 * MB),
        rss: budget + MB, // RSS itself over budget — genuine OOM
        external: Math.round(47 * MB),
      },
      nativeBudgetBytes: budget,
    });

    assert(
      perfStats.analysisHeapAborted,
      "RSS over budget must still abort the loop (no masking of real OOM)",
    );
    assertEquals(
      chunkCalls,
      0,
      "no chunk should run once RSS exceeds the native budget",
    );
  },
);

Deno.test(
  "in-loop heap guard: monitoring disabled never aborts even if heap CRITICAL",
  async () => {
    const { perfStats, chunkCalls } = await runWith({
      heapSample: { heapUsed: 99, heapTotal: 100 },
      memoryEnabled: false,
    });

    assertFalse(
      perfStats.analysisHeapAborted,
      "guard must honour memory.enabled === false (legacy behaviour)",
    );
    assert(
      chunkCalls > 0,
      "with monitoring disabled the loop must run chunks as before",
    );
  },
);
