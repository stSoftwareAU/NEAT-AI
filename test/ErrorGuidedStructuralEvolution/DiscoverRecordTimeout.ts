import { assertEquals, assertFalse } from "@std/assert";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructureDeps } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

const STUB_DEPS: Partial<DiscoverStructureDeps> = {
  isRustDiscoveryEnabled: () => true,
  isRustLibraryAvailable: () => true,
  recordDiscovery: () => ({
    success: true,
    file: "chunk.parquet",
  }),
  mergeDiscoveryParquet: () => ({
    success: true,
    outputFile: "output.parquet",
  }),
  analyzeNeurons: () => ({ success: true, helpfulNeurons: [] }),
  analyzeSynapses: () => ({
    success: true,
    helpfulSynapses: [],
    harmfulSynapses: [],
  }),
  readDiscoveryRecords: () => ({ success: true, records: [] }),
};

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [{
      uuid: "output-0",
      type: "output",
      squash: IDENTITY.NAME,
      bias: 0,
    }],
    synapses: [{
      fromUUID: "input-0",
      toUUID: "output-0",
      weight: 0.5,
    }, {
      fromUUID: "input-1",
      toUUID: "output-0",
      weight: -0.25,
    }],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeTrainingData(): DataRecordInterface[] {
  const samples: DataRecordInterface[] = [];
  for (let i = 0; i < 5; i++) {
    samples.push({
      input: Float32Array.from([Math.random(), Math.random()]),
      output: Float32Array.from([Math.random()]),
    });
  }
  return samples;
}

Deno.test("DiscoverStructure.record aborts when timeout already expired", () => {
  const creature = makeTestCreature();
  const discoverStructure = new DiscoverStructure(
    creature,
    1, // timeoutSeconds
    undefined,
    STUB_DEPS,
  );
  const neuronPromises = new Map<string, Promise<void>>();
  discoverStructure.initialize(neuronPromises);

  // Force timeout to be in the past before recording begins.
  (discoverStructure as unknown as { timeoutTS: number }).timeoutTS =
    Date.now() - 10;

  const trainingData = makeTrainingData();
  const recorded = discoverStructure.record(
    trainingData,
    neuronPromises,
    "test.bin",
    [0, 1, 2, 3, 4],
  );

  assertFalse(recorded, "record should return false after timeout");

  const accumulated = (discoverStructure as unknown as {
    rustAccumulatedData: DataRecordInterface[];
  }).rustAccumulatedData.length;
  assertEquals(
    accumulated,
    0,
    "No samples should be accumulated once timeout is reached",
  );
});
