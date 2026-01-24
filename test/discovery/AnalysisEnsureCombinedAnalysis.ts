/**
 * Tests that analysis methods (analyzeSelectedNeurons, analyzeMissingNeurons,
 * analyzeSelectedNeuronsForRemoval) call ensureRustCombinedAnalysis to populate
 * the cache before reading from it.
 *
 * Issue: The fallback to runRustNeuronAnalysis and runRustSynapseAnalysis was
 * removed, but the cache population via ensureRustCombinedAnalysis was not added.
 */
import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import type {
  RustCandidateNeuron,
  RustCandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("analyzeSelectedNeurons calls analyzeParallel to populate cache", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  let analyzeParallelCalled = false;

  const helpfulSynapse: RustCandidateSynapse = {
    fromNeuronUuid: "input-1",
    toNeuronUuid: "hidden-1",
    weight: 0.3,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0.5,
    improvedCount: 5,
    totalCount: 10,
  };

  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({
        success: true,
        file: "chunk.parquet",
      }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => {
        analyzeParallelCalled = true;
        return {
          success: true,
          helpfulNeurons: [],
          helpfulSynapses: [helpfulSynapse],
          harmfulSynapses: [],
        };
      },
      readDiscoveryRecords: () => ({
        success: true,
        records: [],
      }),
    },
  );

  const neuronPromises = new Map<string, Promise<void>>();

  try {
    structure.initialize(neuronPromises);

    // Record some data to set up parquetFilePath
    const trainingRecords: DataRecordInterface[] = [];
    for (let i = 0; i < 10; i++) {
      trainingRecords.push({
        input: Float32Array.from([i / 10, (i + 1) / 10]),
        output: Float32Array.from([i / 5]),
      });
    }
    structure.record(trainingRecords, neuronPromises);
    structure.flushRustRecording();

    // Call analyzeSelectedNeurons directly
    await structure.analyzeSelectedNeurons(["hidden-1"]);

    assert(
      analyzeParallelCalled,
      "analyzeParallel should be called to populate cache before reading",
    );
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("analyzeMissingNeurons calls analyzeParallel to populate cache", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  let analyzeParallelCalled = false;

  const helpfulNeuron: RustCandidateNeuron = {
    sourceNeuronUuid: "input-0",
    targetNeuronUuid: "output-0",
    squash: "TANH",
    bias: 0,
    incomingWeight: 0.5,
    outgoingWeight: 0.3,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0.8,
    improvedCount: 8,
    totalCount: 10,
  };

  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({
        success: true,
        file: "chunk.parquet",
      }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => {
        analyzeParallelCalled = true;
        return {
          success: true,
          helpfulNeurons: [helpfulNeuron],
          helpfulSynapses: [],
          harmfulSynapses: [],
        };
      },
      readDiscoveryRecords: () => ({
        success: true,
        records: [],
      }),
    },
  );

  const neuronPromises = new Map<string, Promise<void>>();

  try {
    structure.initialize(neuronPromises);

    // Record some data to set up parquetFilePath
    const trainingRecords: DataRecordInterface[] = [];
    for (let i = 0; i < 10; i++) {
      trainingRecords.push({
        input: Float32Array.from([i / 10, (i + 1) / 10]),
        output: Float32Array.from([i / 5]),
      });
    }
    structure.record(trainingRecords, neuronPromises);
    structure.flushRustRecording();

    // Call analyzeMissingNeurons directly
    await structure.analyzeMissingNeurons(["output-0"]);

    assert(
      analyzeParallelCalled,
      "analyzeParallel should be called to populate cache before reading",
    );
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("analyzeSelectedNeuronsForRemoval calls analyzeParallel to populate cache", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  let analyzeParallelCalled = false;

  const harmfulSynapse: RustCandidateSynapse = {
    fromNeuronUuid: "input-1",
    toNeuronUuid: "output-0",
    weight: -0.25,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: -0.2,
    improvedCount: -2,
    totalCount: 10,
  };

  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: () => ({
        success: true,
        file: "chunk.parquet",
      }),
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => {
        analyzeParallelCalled = true;
        return {
          success: true,
          helpfulNeurons: [],
          helpfulSynapses: [],
          harmfulSynapses: [harmfulSynapse],
        };
      },
      readDiscoveryRecords: () => ({
        success: true,
        records: [],
      }),
    },
  );

  const neuronPromises = new Map<string, Promise<void>>();

  try {
    structure.initialize(neuronPromises);

    // Record some data to set up parquetFilePath
    const trainingRecords: DataRecordInterface[] = [];
    for (let i = 0; i < 10; i++) {
      trainingRecords.push({
        input: Float32Array.from([i / 10, (i + 1) / 10]),
        output: Float32Array.from([i / 5]),
      });
    }
    structure.record(trainingRecords, neuronPromises);
    structure.flushRustRecording();

    // Call analyzeSelectedNeuronsForRemoval directly
    await structure.analyzeSelectedNeuronsForRemoval(["output-0"]);

    assert(
      analyzeParallelCalled,
      "analyzeParallel should be called to populate cache before reading",
    );
  } finally {
    await structure.cleanUp();
  }
});
