import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import type { RustRecordInput } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

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

Deno.test("DiscoverStructure normalises record indices for single binary chunk", async () => {
  const creature = makeCreature();
  const recordedInputs: RustRecordInput[] = [];

  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (input) => {
        recordedInputs.push(input);
        return {
          success: true,
          file: "chunk.parquet",
        };
      },
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeNeurons: () => ({
        success: true,
        helpfulNeurons: [],
      }),
      analyzeSynapses: () => ({
        success: true,
        helpfulSynapses: [],
        harmfulSynapses: [],
      }),
      readDiscoveryRecords: () => ({
        success: true,
        records: [],
      }),
    },
  );

  const neuronPromises = new Map<string, Promise<void>>();

  try {
    structure.initialize(neuronPromises);

    const trainingRecords: DataRecordInterface[] = [];
    const rawIndices: number[] = [];

    for (let i = 0; i < 10; i++) {
      const input = Float32Array.from([i / 10, (i + 1) / 10]);
      const output = Float32Array.from([i / 5]);
      trainingRecords.push({
        input,
        output,
      });
      rawIndices.push(100 + i * 37); // Large indices that exceed chunk length
    }

    const recorded = structure.record(
      trainingRecords,
      neuronPromises,
      "/tmp/fake.bin",
      rawIndices,
    );
    assert(recorded, "record call should succeed");

    const flushed = structure.flushRustChunk();
    assertEquals(flushed, true, "flush should succeed");

    assertEquals(
      recordedInputs.length,
      1,
      "recordDiscovery should be invoked once",
    );
    const [input] = recordedInputs;
    assert(input.record_indices, "record indices should be provided to Rust");
    const expectedIndices = rawIndices.map((_value, idx) => idx);
    assertEquals(
      input.record_indices,
      expectedIndices,
      "record indices should be normalised to chunk-relative offsets",
    );
  } finally {
    await structure.cleanUp();
  }
});
