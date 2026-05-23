/**
 * Tests for the per-chunk Rust combined-analysis cache release
 * (Issue #2642).
 *
 * The discovery analysis loop holds the most recent Rust analysis result in
 * `DiscoverStructure.combinedRustAnalysis` so successive scope-specific calls
 * (`analyzeSelectedNeurons`, `analyzeMissingNeurons`, etc.) can reuse it
 * without re-invoking the FFI. While the combined-analysis chunked code path
 * is in flight, however, only the per-chunk
 * `collectRustAnalysisCandidates` call reads the cache — anything that
 * follows (squash analysis, accumulation, next chunk's allocation) sees the
 * prior chunk's result as pure retained heap.
 *
 * `releaseCombinedRustAnalysisCache()` drops that reference so V8 can
 * reclaim the per-chunk helpful/harmful candidate arrays before the next FFI
 * chunk allocates a fresh result. These tests assert the contract used by
 * `runAnalysisLoop`:
 *
 * 1. After a cache-populating call, the cache is non-empty.
 * 2. `releaseCombinedRustAnalysisCache()` clears the cache so a subsequent
 *    read returns `undefined` (forcing the next chunk to call into Rust).
 * 3. Calling the release on an already-empty cache is a no-op.
 * 4. `runAnalysisLoop` releases the cache after each chunk, so the cache is
 *    empty when the loop returns.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import { PhaseDiagnostics } from "@architecture/ErrorGuidedStructuralEvolution/PhaseDiagnostics.ts";
import { runAnalysisLoop } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type {
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { readRustCombinedAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
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

/**
 * Build a `DiscoverStructure` wired to a deterministic in-memory
 * `analyzeParallel` stub that always returns a non-empty result so the
 * cache is populated.
 */
async function buildStructure(
  analyzeParallel: (
    input: RustParallelAnalysisInput,
  ) => RustParallelAnalysisResult,
): Promise<
  { structure: DiscoverStructure; tempParquetPath: string }
> {
  await initWasmForTests();

  const creature = makeTestCreature();
  const tempParquetPath = await Deno.makeTempFile({
    prefix: "analysis-cache-release-",
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
    analyzeParallel,
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };

  const structure = new DiscoverStructure(creature, 600, 100, deps);
  const neuronPromises = new Map<number, Promise<void>>();
  structure.initialize(neuronPromises);
  structure.record(makeTrainingData(), neuronPromises);
  structure.flushRustRecording();
  structure.extendTimeoutForAnalysis(600);

  return { structure, tempParquetPath };
}

Deno.test("releaseCombinedRustAnalysisCache clears the cached chunk result", async () => {
  const { structure, tempParquetPath } = await buildStructure(() => ({
    success: true,
    helpfulNeurons: [],
    helpfulSynapses: [
      {
        fromNeuronUuid: "input-0",
        toNeuronUuid: "hidden-a",
        weight: 0.1,
        targetNeuronImpact: 1,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 1,
        totalCount: 1,
      },
    ],
    harmfulSynapses: [],
  }));

  try {
    // Find a runtime id for any non-input neuron.
    const focusId = structure["creature"].neurons.find((n) =>
      n.type !== "input"
    )!.id;

    // Populate the cache.
    const populated = structure.ensureRustCombinedAnalysis(
      [focusId],
      true,
      true,
    );
    assert(populated, "analyzeParallel stub should produce a result");

    // Sanity check: a subsequent read with the same focus list hits the cache.
    const cachedRead = readRustCombinedAnalysis(
      structure["combinedRustAnalysis"],
      structure["parquetFilePath"],
      [focusId],
      true,
      true,
    );
    assert(cachedRead, "cache should be live before release");

    // Release the cache.
    structure.releaseCombinedRustAnalysisCache();

    // The same read must now miss.
    const missedRead = readRustCombinedAnalysis(
      structure["combinedRustAnalysis"],
      structure["parquetFilePath"],
      [focusId],
      true,
      true,
    );
    assertEquals(
      missedRead,
      undefined,
      "cache should be empty after release",
    );

    // Calling release again is a safe no-op (still empty).
    structure.releaseCombinedRustAnalysisCache();
    assertEquals(structure["combinedRustAnalysis"], undefined);
  } finally {
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // Ignore cleanup failures
    }
  }
});

Deno.test("runAnalysisLoop releases the combined analysis cache after every chunk", async () => {
  // Build a stub that returns a moderately-sized helpful synapse list for
  // each chunk so the cache, were it not released, would retain real
  // payload between chunks.
  const makeStubResult = (): RustParallelAnalysisResult => ({
    success: true,
    helpfulNeurons: [],
    helpfulSynapses: Array.from({ length: 50 }, (_, i) => ({
      fromNeuronUuid: "input-0",
      toNeuronUuid: `hidden-${i % 3 === 0 ? "a" : i % 3 === 1 ? "b" : "c"}`,
      weight: 0.1,
      targetNeuronImpact: 1,
      expectedCreatureErrorReduction: 0.001,
      expectedCreatureScoreGain: 0.001,
      improvedCount: 1,
      totalCount: 1,
    })),
    harmfulSynapses: [],
  });

  const { structure, tempParquetPath } = await buildStructure(() =>
    makeStubResult()
  );

  try {
    const config = createNeatConfig({
      discoveryAnalysisTimeoutMinutes: 10,
      discoveryMaxNeurons: 3,
      discoveryAnalysisChunkSize: 1, // force multiple chunks
      discoveryAnalysisPerChunkMaxMs: 0,
    });

    const perfStats = new DiscoveryPerformanceStats();
    const phaseDiagnostics = new PhaseDiagnostics("analysis");
    const deadlineMs = Date.now() + 10 * 60 * 1000;

    await runAnalysisLoop(
      {
        ID: "T-2642",
        config,
        discoveryMaxNeurons: 3,
        costOfGrowth: 0,
        analysisChunkSize: 1,
        perChunkMaxMs: 0,
        getTimeoutTS: () => deadlineMs,
        refreshAnalysisTimeout: () => {},
        // Issue #2735: exercises cache release, not the heap guard; opt out so
        // the test process heap ratio does not trip the in-loop heap abort.
        heapCriticalProbe: () => false,
      },
      structure,
      perfStats,
      phaseDiagnostics,
    );

    // The chunk loop must leave the cache empty so a subsequent discovery
    // cycle does not retain the last chunk's helpful-synapse buffer.
    assertEquals(
      structure["combinedRustAnalysis"],
      undefined,
      "cache must be released by runAnalysisLoop after final chunk",
    );
  } finally {
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // Ignore cleanup failures
    }
  }
});
