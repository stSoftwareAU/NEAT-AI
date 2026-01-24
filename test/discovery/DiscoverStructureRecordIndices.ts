import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import type { RustRecordInput } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
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

Deno.test("DiscoverStructure preserves record indices for single binary chunk", async () => {
  await initWasmForTests();
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
      analyzeParallel: () => ({
        success: true,
        helpfulNeurons: [],
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
    assertEquals(
      input.record_indices,
      rawIndices,
      "record indices should retain their absolute offsets",
    );
  } finally {
    await structure.cleanUp();
  }
});

function makeBatch(
  startIndex: number,
  count: number,
): { trainingRecords: DataRecordInterface[]; rawIndices: number[] } {
  const trainingRecords: DataRecordInterface[] = [];
  const rawIndices: number[] = [];

  for (let i = 0; i < count; i++) {
    const activationSeed = startIndex + i;
    const input = Float32Array.from([activationSeed / 100, 1]);
    const output = Float32Array.from([activationSeed / 200]);
    trainingRecords.push({ input, output });
    rawIndices.push(startIndex + i);
  }

  return { trainingRecords, rawIndices };
}

Deno.test("DiscoverStructure keeps slice offsets across multiple chunk flushes", async () => {
  await initWasmForTests();
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
          file: `chunk-${recordedInputs.length}.parquet`,
        };
      },
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => ({
        success: true,
        helpfulNeurons: [],
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

    const firstBatch = makeBatch(0, 4);
    assert(
      structure.record(
        firstBatch.trainingRecords,
        neuronPromises,
        "/tmp/fake.bin",
        firstBatch.rawIndices,
      ),
      "first slice should record successfully",
    );
    assertEquals(structure.flushRustChunk(), true);

    const secondBatch = makeBatch(512, 4);
    assert(
      structure.record(
        secondBatch.trainingRecords,
        neuronPromises,
        "/tmp/fake.bin",
        secondBatch.rawIndices,
      ),
      "second slice should record successfully",
    );
    assertEquals(structure.flushRustChunk(), true);

    assertEquals(
      recordedInputs.length,
      2,
      "each flush should invoke recordDiscovery",
    );

    assertEquals(
      recordedInputs[0].record_indices,
      firstBatch.rawIndices,
      "first slice should keep base offsets",
    );
    assertEquals(
      recordedInputs[1].record_indices,
      secondBatch.rawIndices,
      "second slice should reference its original offsets",
    );
  } finally {
    await structure.cleanUp();
  }
});
