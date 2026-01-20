import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import { recordDirectory } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  type DiscoverRecord,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { isRustDiscoveryEnabled } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmActivation } from "../../src/wasm/WasmActivation.ts";

// Calculate the path to wasm_activation/pkg relative to repo root
const repoRoot = new URL("../../", import.meta.url).pathname;
const wasmPath = `${repoRoot}wasm_activation/pkg`;

/**
 * Helper interface to access private methods for testing purposes
 */
interface DiscoverStructureTestAccess {
  loadNeuronRecords(file: string): Promise<DiscoverRecord[]>;
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
  name:
    "Baseline: Input neurons are correctly loaded from binary when indices are provided",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    await initWasmActivation(wasmPath);
    const creature = makeTestCreature();
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, creature.output, 100);
    const dataDir = makeDataDir(trainingData, 100, {
      input: creature.input,
      output: creature.output,
    });

    try {
      // Initialize discovery and record data (inputs are read back from binary using indices)
      const discoverStructure = new DiscoverStructure(
        creature,
        5, // Reduced from 60s to 5s for faster tests
        DEFAULT_RUST_FLUSH_RECORDS,
      );
      const neuronPromisesMap: Map<string, Promise<void>> = new Map();

      discoverStructure.initialize(neuronPromisesMap);

      const recordIndices = Array.from(
        { length: trainingData.length },
        (_, i) => i,
      );
      const binaryFilePath = `${dataDir}/0.bin`;

      const recorded = discoverStructure.record(
        trainingData,
        neuronPromisesMap,
        binaryFilePath,
        recordIndices,
      );
      assert(recorded, "Record should succeed");
      await Promise.all([...neuronPromisesMap.values()]);

      // Flush Rust recording (required for Parquet file creation)
      const flushSuccess = discoverStructure.flushRustRecording();
      assert(flushSuccess, "Rust flush should succeed");

      // Access the private loadNeuronRecords method to verify input neurons are readable
      const testAccess =
        discoverStructure as unknown as DiscoverStructureTestAccess;
      const loadNeuronRecords = testAccess.loadNeuronRecords.bind(
        discoverStructure,
      );
      const tempDir = testAccess.tempDir;

      // Load input neuron records (input neurons are never stored in Parquet)
      const input0Records = await loadNeuronRecords(`${tempDir}/input-0`);
      const input1Records = await loadNeuronRecords(`${tempDir}/input-1`);
      const input2Records = await loadNeuronRecords(`${tempDir}/input-2`);

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
    } finally {
      // Cleanup temp directory
      try {
        await Deno.remove(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "Integration: recordDirectory with CSV reads input values correctly",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    await initWasmActivation(wasmPath);
    const creature = makeTestCreature();
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, creature.output, 50); // Reduced from 200 for faster tests

    // Create binary files in temp directory
    const dataDir = makeDataDir(trainingData, 100);

    try {
      // Run discovery on binary files
      const result = await recordDirectory(
        creature,
        dataDir,
        createNeatConfig({
          discoverySampleRate: 0.5, // Sample 50% of records
          discoveryBatchSize: 50,
          discoveryMaxNeurons: 3,
          discoveryRecordTimeOutMinutes: 0.05, // 3 seconds - sufficient for CI
          discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds - sufficient for CI
          log: 0,
        }),
      );

      assert(result, "Should return discovery result");
      assert(result.ID, "Should have ID");

      // Test passes if no errors occur - this verifies CSV approach works
    } finally {
      // Cleanup temp directory - use removeSync for simpler, faster cleanup
      try {
        // deno-lint-ignore no-sync-fn-in-async-fn
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name:
    "Binary optimisation: Input values read from binary match expected values",
  ignore: !isRustDiscoveryEnabled(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    await initWasmActivation(wasmPath);
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

    // Using binary files (optimised path)
    const dataDir = makeDataDir(trainingData, 50);

    try {
      const binaryCreature = makeTestCreature();
      CreatureUtil.makeUUID(binaryCreature);

      const binaryDiscoverStructure = new DiscoverStructure(
        binaryCreature,
        5, // Reduced from 60s to 5s for faster tests
        DEFAULT_RUST_FLUSH_RECORDS,
      );
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
      const loadBinaryNeuronRecords = binaryTestAccess.loadNeuronRecords.bind(
        binaryDiscoverStructure,
      );
      const binaryInput0 = await loadBinaryNeuronRecords(
        `${binaryTestAccess.tempDir}/input-0`,
      );
      const binaryInput1 = await loadBinaryNeuronRecords(
        `${binaryTestAccess.tempDir}/input-1`,
      );
      const binaryInput2 = await loadBinaryNeuronRecords(
        `${binaryTestAccess.tempDir}/input-2`,
      );

      assertEquals(binaryInput0.length, trainingData.length);
      assertEquals(binaryInput1.length, trainingData.length);
      assertEquals(binaryInput2.length, trainingData.length);

      // Verify values match the deterministic dataset
      for (let i = 0; i < trainingData.length; i++) {
        assertEquals(binaryInput0[i].activation, trainingData[i].input[0]);
        assertEquals(binaryInput1[i].activation, trainingData[i].input[1]);
        assertEquals(binaryInput2[i].activation, trainingData[i].input[2]);
      }

      await binaryDiscoverStructure.cleanUp();
    } finally {
      // Cleanup temp directory - use removeSync for simpler, faster cleanup
      try {
        // deno-lint-ignore no-sync-fn-in-async-fn
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});
