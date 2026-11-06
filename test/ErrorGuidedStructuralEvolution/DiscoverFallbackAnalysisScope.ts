/**
 * Tests for the scope and deadline each discovery analysis entry point hands
 * to the native `analyzeParallel` call (Issue #4141).
 *
 * The fallback analyses for a chunk whose combined analysis failed must each
 * ask the native side for the one candidate kind they read, and must carry the
 * per-chunk deadline. `mapRustAnalysisCandidates` must map a result the caller
 * already holds without issuing another native analysis.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type {
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";

const CHUNK_DEADLINE_MS = 6_500;

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: -0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: -0.25 },
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

const HELPFUL_SYNAPSE_RESULT: RustParallelAnalysisResult = {
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
};

async function withStructure(
  analyzeParallel: (
    input: RustParallelAnalysisInput,
  ) => RustParallelAnalysisResult,
  body: (structure: DiscoverStructure, focusId: number) => Promise<void>,
): Promise<void> {
  await initWasmForTests();

  const creature = makeTestCreature();
  const tempParquetPath = await Deno.makeTempFile({
    prefix: "discover-fallback-scope-",
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

  try {
    const focusId = creature.neurons.find((n) => n.type === "hidden")!.id;
    await body(structure, focusId);
  } finally {
    await structure.cleanUp();
    try {
      await Deno.remove(tempParquetPath);
    } catch {
      // Ignore cleanup failures
    }
  }
}

function recordingFailure(inputs: RustParallelAnalysisInput[]) {
  return (input: RustParallelAnalysisInput): RustParallelAnalysisResult => {
    inputs.push(input);
    return { success: false, error: "gpu failure" };
  };
}

Deno.test("analyzeSelectedNeurons asks only for synapse candidates, within the chunk deadline (Issue #4141)", async () => {
  const inputs: RustParallelAnalysisInput[] = [];
  await withStructure(recordingFailure(inputs), async (structure, focusId) => {
    await structure.analyzeSelectedNeurons([focusId], CHUNK_DEADLINE_MS);
  });

  assertEquals(inputs.length, 1);
  assert(inputs[0].maxSynapseCandidates !== undefined);
  assertEquals(inputs[0].maxNeuronCandidates, undefined);
  assertEquals(inputs[0].analysisDeadlineMs, CHUNK_DEADLINE_MS);
});

Deno.test("analyzeMissingNeurons asks only for neuron candidates, within the chunk deadline (Issue #4141)", async () => {
  const inputs: RustParallelAnalysisInput[] = [];
  await withStructure(recordingFailure(inputs), async (structure, focusId) => {
    await structure.analyzeMissingNeurons([focusId], CHUNK_DEADLINE_MS);
  });

  assertEquals(inputs.length, 1);
  assertEquals(inputs[0].maxSynapseCandidates, undefined);
  assert(inputs[0].maxNeuronCandidates !== undefined);
  assertEquals(inputs[0].analysisDeadlineMs, CHUNK_DEADLINE_MS);
});

Deno.test("analyzeSelectedNeuronsForRemoval asks only for synapse candidates, within the chunk deadline (Issue #4141)", async () => {
  const inputs: RustParallelAnalysisInput[] = [];
  await withStructure(recordingFailure(inputs), async (structure, focusId) => {
    await structure.analyzeSelectedNeuronsForRemoval(
      [focusId],
      CHUNK_DEADLINE_MS,
    );
  });

  assertEquals(inputs.length, 1);
  assert(inputs[0].maxSynapseCandidates !== undefined);
  assertEquals(inputs[0].maxNeuronCandidates, undefined);
  assertEquals(inputs[0].analysisDeadlineMs, CHUNK_DEADLINE_MS);
});

Deno.test("collectRustAnalysisCandidates returns the mapped bundle of one combined analysis", async () => {
  let calls = 0;
  await withStructure(() => {
    calls++;
    return HELPFUL_SYNAPSE_RESULT;
  }, async (structure, focusId) => {
    const bundle = await structure.collectRustAnalysisCandidates([focusId]);

    assertEquals(calls, 1);
    assertEquals(bundle?.helpfulSynapses?.length, 1);
  });
});

Deno.test("mapRustAnalysisCandidates maps a held result without a native analysis (Issue #4141)", async () => {
  let calls = 0;
  await withStructure(() => {
    calls++;
    return HELPFUL_SYNAPSE_RESULT;
  }, async (structure, focusId) => {
    const combined = await structure.ensureRustCombinedAnalysis(
      [focusId],
      true,
      true,
      CHUNK_DEADLINE_MS,
    );
    assertEquals(calls, 1);

    // Drop the cache so a hidden re-run would have to call native again.
    structure.releaseCombinedRustAnalysisCache();
    const bundle = structure.mapRustAnalysisCandidates(combined, [focusId]);

    assertEquals(calls, 1, "mapping must not issue a native analysis");
    assertEquals(bundle?.helpfulSynapses?.length, 1);
    assertEquals(
      structure.mapRustAnalysisCandidates(undefined, [focusId]),
      undefined,
    );
  });
});
