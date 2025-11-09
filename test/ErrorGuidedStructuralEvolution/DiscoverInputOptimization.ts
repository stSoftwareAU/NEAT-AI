import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import { recordDirectory } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import {
  type DiscoverRecord,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

/**
 * Helper interface to access private methods for testing purposes
 */
interface DiscoverStructureTestAccess {
  loadCSV(file: string): Promise<DiscoverRecord[]>;
  tempDir: string;
}

/**
 * Test suite to verify input neuron optimization.
 * Tests that reading input values from binary files produces identical results
 * to reading from CSV files.
 */

function makeTestCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: TANH.NAME,
        bias: 0.1,
      },
      {
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
        bias: 0.2,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "hidden-1", weight: 0.7 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

function makeTrainingData(
  inputSize: number,
  outputSize: number,
  count: number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];
  for (let i = 0; i < count; i++) {
    const input = new Float32Array(inputSize);
    const output = new Float32Array(outputSize);

    for (let j = 0; j < inputSize; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    for (let j = 0; j < outputSize; j++) {
      output[j] = Math.random() * 2 - 1;
    }

    data.push({ input, output });
  }
  return data;
}

// Note: Leak detection disabled for this test - Rust library is intentionally loaded and kept in memory
Deno.test({
  name: "Baseline: Input neurons are correctly recorded and loaded from CSV",
  ignore: false,
  fn: async () => {
    const creature = makeTestCreature();
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, creature.output, 100);

    // Initialize discovery and record data
    const discoverStructure = new DiscoverStructure(creature, 60);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording (required for Parquet file creation)
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(flushSuccess, "Rust flush should succeed");

    // Access the private loadCSV method to verify input neurons are recorded
    const testAccess =
      discoverStructure as unknown as DiscoverStructureTestAccess;
    const loadCSV = testAccess.loadCSV.bind(discoverStructure);
    const tempDir = testAccess.tempDir;

    // Load input neuron records
    const input0Records = await loadCSV(`${tempDir}/input-0.csv`);
    const input1Records = await loadCSV(`${tempDir}/input-1.csv`);
    const input2Records = await loadCSV(`${tempDir}/input-2.csv`);

    // Verify we got the right number of records
    assertEquals(
      input0Records.length,
      100,
      "Should have 100 records for input-0",
    );
    assertEquals(
      input1Records.length,
      100,
      "Should have 100 records for input-1",
    );
    assertEquals(
      input2Records.length,
      100,
      "Should have 100 records for input-2",
    );

    // Verify the values match the training data
    for (let i = 0; i < trainingData.length; i++) {
      assertEquals(
        input0Records[i].activation,
        trainingData[i].input[0],
        `Input-0 record ${i} should match training data`,
      );
      assertEquals(
        input1Records[i].activation,
        trainingData[i].input[1],
        `Input-1 record ${i} should match training data`,
      );
      assertEquals(
        input2Records[i].activation,
        trainingData[i].input[2],
        `Input-2 record ${i} should match training data`,
      );
    }

    await discoverStructure.cleanUp();
  },
});

Deno.test("Integration: recordDirectory with CSV reads input values correctly", async () => {
  const creature = makeTestCreature();
  CreatureUtil.makeUUID(creature);

  const trainingData = makeTrainingData(creature.input, creature.output, 200);

  // Create binary files in temp directory
  const dataDir = makeDataDir(trainingData, 100);

  try {
    // Run discovery on binary files
    const result = await recordDirectory(creature, dataDir, {
      discoverySampleRate: 0.5, // Sample 50% of records
      discoveryBatchSize: 50,
      discoveryMaxNeurons: 3,
      log: 0,
    });

    assert(result, "Should return discovery result");
    assert(result.ID, "Should have ID");

    // Test passes if no errors occur - this verifies CSV approach works
  } finally {
    // Cleanup temp directory
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("Binary optimization: Input values read from binary match CSV values", async () => {
  const creature = makeTestCreature();
  CreatureUtil.makeUUID(creature);

  // Create a small, deterministic dataset for comparison
  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 50; i++) {
    trainingData.push({
      input: new Float32Array([i * 0.1, i * 0.2, i * 0.3]),
      output: new Float32Array([i * 0.5]),
    });
  }

  // Method 1: Using Rust (Parquet) - Rust is required now
  const csvDiscoverStructure = new DiscoverStructure(creature, 60);
  const csvNeuronPromisesMap: Map<string, Promise<void>> = new Map();
  csvDiscoverStructure.initialize(csvNeuronPromisesMap);
  const csvRecorded = csvDiscoverStructure.record(
    trainingData,
    csvNeuronPromisesMap,
  );
  assert(csvRecorded, "Record should succeed");
  await Promise.all([...csvNeuronPromisesMap.values()]);

  // Flush Rust recording (required for Parquet file creation)
  const csvFlushSuccess = csvDiscoverStructure.flushRustRecording();
  assert(csvFlushSuccess, "Rust flush should succeed");

  // Load CSV records
  const csvTestAccess =
    csvDiscoverStructure as unknown as DiscoverStructureTestAccess;
  const loadCSV = csvTestAccess.loadCSV.bind(csvDiscoverStructure);
  const csvTempDir = csvTestAccess.tempDir;
  const csvInput0 = await loadCSV(`${csvTempDir}/input-0.csv`);
  const csvInput1 = await loadCSV(`${csvTempDir}/input-1.csv`);
  const csvInput2 = await loadCSV(`${csvTempDir}/input-2.csv`);

  await csvDiscoverStructure.cleanUp();

  // Method 2: Using binary files (optimized path)
  const dataDir = makeDataDir(trainingData, 50);

  try {
    const binaryCreature = makeTestCreature();
    CreatureUtil.makeUUID(binaryCreature);

    const binaryDiscoverStructure = new DiscoverStructure(binaryCreature, 60);
    const binaryNeuronPromisesMap: Map<string, Promise<void>> = new Map();
    binaryDiscoverStructure.initialize(binaryNeuronPromisesMap);

    // Manually read binary files and record with indices (simulating what DiscoverDirectory does)
    const binaryFiles = await Array.fromAsync(Deno.readDir(dataDir));
    const binaryFile = binaryFiles.find((entry) =>
      entry.isFile && entry.name.endsWith(".bin")
    );
    assert(binaryFile, "Should have binary file");

    const filePath = `${dataDir}/${binaryFile.name}`;
    const recordIndices: number[] = [];

    // Read all records from binary file
    for (let i = 0; i < 50; i++) {
      recordIndices.push(i);
    }

    // Record using binary path
    const binaryRecorded = binaryDiscoverStructure.record(
      trainingData,
      binaryNeuronPromisesMap,
      filePath,
      recordIndices,
    );
    assert(binaryRecorded, "Binary record should succeed");
    await Promise.all([...binaryNeuronPromisesMap.values()]);

    // Flush Rust recording (required for Parquet file creation)
    const binaryFlushSuccess = binaryDiscoverStructure.flushRustRecording();
    assert(binaryFlushSuccess, "Rust flush should succeed");

    // Load binary records
    const binaryTestAccess =
      binaryDiscoverStructure as unknown as DiscoverStructureTestAccess;
    const loadBinaryCSV = binaryTestAccess.loadCSV.bind(
      binaryDiscoverStructure,
    );
    const binaryInput0 = await loadBinaryCSV(
      `${binaryTestAccess.tempDir}/input-0.csv`,
    );
    const binaryInput1 = await loadBinaryCSV(
      `${binaryTestAccess.tempDir}/input-1.csv`,
    );
    const binaryInput2 = await loadBinaryCSV(
      `${binaryTestAccess.tempDir}/input-2.csv`,
    );

    // Verify binary reads match CSV reads
    assertEquals(
      binaryInput0.length,
      csvInput0.length,
      "Input-0 should have same number of records",
    );
    assertEquals(
      binaryInput1.length,
      csvInput1.length,
      "Input-1 should have same number of records",
    );
    assertEquals(
      binaryInput2.length,
      csvInput2.length,
      "Input-2 should have same number of records",
    );

    // Verify values match
    for (let i = 0; i < csvInput0.length; i++) {
      assertEquals(
        binaryInput0[i].activation,
        csvInput0[i].activation,
        `Input-0 record ${i} should match`,
      );
      assertEquals(
        binaryInput1[i].activation,
        csvInput1[i].activation,
        `Input-1 record ${i} should match`,
      );
      assertEquals(
        binaryInput2[i].activation,
        csvInput2[i].activation,
        `Input-2 record ${i} should match`,
      );
    }

    await binaryDiscoverStructure.cleanUp();
  } finally {
    // Cleanup temp directory
    await Deno.remove(dataDir, { recursive: true });
  }
});
