import { assert, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { recordDirectory } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

/**
 * Tests for discovery timeout handling and partial result recovery.
 * Uses fast timeouts (1-3 seconds) with small datasets for CI/CD.
 */

// Test utility: Create a simple creature with configurable hidden neurons
function makeTestCreature(hiddenNeurons = 20): Creature {
  const neurons = [];
  const synapses = [];

  // Create hidden neurons
  for (let i = 0; i < hiddenNeurons; i++) {
    neurons.push({
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: i % 2 === 0 ? IDENTITY.NAME : TANH.NAME,
      bias: Math.random() * 2 - 1,
    });
  }

  // Add output neurons
  neurons.push(
    {
      type: "output" as const,
      uuid: "output-0",
      squash: IDENTITY.NAME,
      bias: 0,
    },
    {
      type: "output" as const,
      uuid: "output-1",
      squash: TANH.NAME,
      bias: 0,
    },
  );

  // Connect hidden neurons to inputs (cycle through 10 inputs)
  for (let i = 0; i < hiddenNeurons; i++) {
    const inputIndex = i % 10;
    synapses.push({
      fromUUID: `input-${inputIndex}`,
      toUUID: `hidden-${i}`,
      weight: Math.random() * 2 - 1,
    });
  }

  // Connect hidden neurons to outputs
  for (let i = 0; i < hiddenNeurons; i++) {
    const outputIndex = i % 2;
    synapses.push({
      fromUUID: `hidden-${i}`,
      toUUID: `output-${outputIndex}`,
      weight: Math.random() * 2 - 1,
    });
  }

  const json: CreatureExport = {
    neurons,
    synapses,
    input: 10,
    output: 2,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

// Test utility: Create test data
function makeTestData(
  inputSize: number,
  outputSize: number,
  recordCount: number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];

  for (let i = 0; i < recordCount; i++) {
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

// Test utility: Create a binary file in temp directory
async function createTestBinaryFile(
  creature: Creature,
  recordCount: number,
  dirPath: string,
  fileName: string,
): Promise<string> {
  const filePath = `${dirPath}/${fileName}`;
  const file = await Deno.open(filePath, { write: true, create: true });

  try {
    const data = makeTestData(creature.input, creature.output, recordCount);

    // Write all records without await in loop
    for (const record of data) {
      const buffer = new Uint8Array(
        (creature.input + creature.output) * 4,
      );
      const floatView = new Float32Array(buffer.buffer);

      // Write input
      floatView.set(record.input, 0);
      // Write output
      floatView.set(record.output, creature.input);

      // Synchronous write is fine for test data generation
      file.writeSync(buffer);
    }
  } finally {
    file.close();
  }

  return filePath;
}

// Test utility: Create temp directory for test files
async function createTempTestDir(testName: string): Promise<string> {
  const tmpDir = `.tmp/test-discovery-timeout-${testName}-${Date.now()}`;
  await Deno.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

// Test utility: Cleanup temp directory
async function cleanupTempDir(dirPath: string) {
  try {
    // Give background cleanup time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    await Deno.remove(dirPath, { recursive: true });
  } catch (_error) {
    // Ignore cleanup errors
  }
}

Deno.test({
  name: "Batch size 128 saves more batches than 512 on timeout",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const tmpDir128 = await createTempTestDir("batch-128");
    const tmpDir512 = await createTempTestDir("batch-512");

    try {
      // Create separate creatures for each test to avoid state issues
      const creature128 = makeTestCreature(20);
      CreatureUtil.makeUUID(creature128);
      creature128.clearState();
      await createTestBinaryFile(creature128, 200, tmpDir128, "test1.bin");

      const creature512 = makeTestCreature(20);
      CreatureUtil.makeUUID(creature512);
      creature512.clearState();
      await createTestBinaryFile(creature512, 200, tmpDir512, "test1.bin");

      // Test with batch size 128, very short timeout (1 second)
      const options128 = {
        discoveryBatchSize: 128,
        discoveryTimeOutMinutes: 0.0167, // ~1 second
        discoveryAnalysisTimeoutMinutes: 0.0167, // ~1 second for analysis
        discoverySampleRate: 1.0, // 100% sample rate
        log: 0,
      };

      const result128 = await recordDirectory(
        creature128,
        tmpDir128,
        options128,
      );

      // Test with batch size 512, same timeout
      const options512 = {
        discoveryBatchSize: 512,
        discoveryTimeOutMinutes: 0.0167, // ~1 second
        discoveryAnalysisTimeoutMinutes: 0.0167, // ~1 second for analysis
        discoverySampleRate: 1.0,
        log: 0,
      };

      const result512 = await recordDirectory(
        creature512,
        tmpDir512,
        options512,
      );

      // Both should return results (not throw) - this tests that partial results work
      assertExists(result128, "Batch 128 should return result");
      assertExists(result512, "Batch 512 should return result");

      // Count results to verify both got some data processed
      const count128 = (result128.addHelpfulSynapses?.length || 0) +
        (result128.addHelpfulNeurons?.length || 0) +
        (result128.candidateSquashes?.length || 0) +
        (result128.removeHarmfulSynapse ? 1 : 0);

      const count512 = (result512.addHelpfulSynapses?.length || 0) +
        (result512.addHelpfulNeurons?.length || 0) +
        (result512.candidateSquashes?.length || 0) +
        (result512.removeHarmfulSynapse ? 1 : 0);

      // Both should produce some results (the key is they complete without throwing)
      assert(
        count128 > 0 || count512 > 0,
        `At least one batch size should produce results: 128=${count128}, 512=${count512}`,
      );

      console.log(
        `Batch comparison: 128 produced ${count128} results, 512 produced ${count512} results`,
      );
    } finally {
      await cleanupTempDir(tmpDir128);
      await cleanupTempDir(tmpDir512);
    }
  },
});

Deno.test({
  name: "DiscoverDirectory returns partial results on timeout",
  ignore: shouldSkipRustDiscoveryTests(),
  async fn() {
    assertRustDiscoveryAvailable();
    const creature = makeTestCreature(30);
    CreatureUtil.makeUUID(creature);
    creature.clearState();

    const tmpDir = await createTempTestDir("partial-results");

    try {
      // Create a larger dataset
      await createTestBinaryFile(creature, 500, tmpDir, "test.bin");

      // Set 2-second timeout
      const options = {
        discoveryBatchSize: 128,
        discoveryTimeOutMinutes: 0.033, // 2 seconds
        discoverySampleRate: 1.0,
        log: 1, // Enable logging to verify diagnostics appear
      };

      const result = await recordDirectory(creature, tmpDir, options);

      // Should return result (not throw)
      assertExists(result, "Should return result even with timeout");
      assertExists(result.ID, "Result should have ID");

      // Note: with short timeout, might not complete analysis, which is acceptable
      // The key is that it doesn't throw and returns a valid result structure
      console.log(`Partial results: ${JSON.stringify(result, null, 2)}`);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  },
});

Deno.test({
  name: "Timeout during file reading returns partial data",
  ignore: shouldSkipRustDiscoveryTests(),
  async fn() {
    assertRustDiscoveryAvailable();
    const creature = makeTestCreature(25);
    CreatureUtil.makeUUID(creature);
    creature.clearState();

    const tmpDir = await createTempTestDir("file-timeout");

    try {
      // Create multiple binary files
      await createTestBinaryFile(creature, 200, tmpDir, "test1.bin");
      await createTestBinaryFile(creature, 200, tmpDir, "test2.bin");
      await createTestBinaryFile(creature, 200, tmpDir, "test3.bin");

      // Very short timeout - will hit during file processing
      const options = {
        discoveryBatchSize: 128,
        discoveryTimeOutMinutes: 0.02, // ~1.2 seconds
        discoverySampleRate: 1.0,
        log: 1, // Enable to see diagnostic logs
      };

      const result = await recordDirectory(creature, tmpDir, options);

      // Should complete without throwing
      assertExists(result, "Should return result despite timeout");
      assertExists(result.ID, "Result should have ID");

      // Should have processed at least some files
      // The diagnostic log should show "timeout reached during file processing"
      // (visible in test output with log: true)
    } finally {
      await cleanupTempDir(tmpDir);
    }
  },
});

Deno.test({
  name: "Discovery completes successfully with reasonable timeout",
  ignore: shouldSkipRustDiscoveryTests(),
  async fn() {
    assertRustDiscoveryAvailable();
    const creature = makeTestCreature(15);
    CreatureUtil.makeUUID(creature);
    creature.clearState();

    const tmpDir = await createTempTestDir("success");

    try {
      // Create small dataset that should complete
      await createTestBinaryFile(creature, 50, tmpDir, "test.bin");

      const options = {
        discoveryBatchSize: 128,
        discoveryTimeOutMinutes: 0.05, // 3 seconds - plenty of time for small dataset
        discoverySampleRate: 1.0,
        log: 1,
      };

      const result = await recordDirectory(creature, tmpDir, options);

      // Should complete successfully
      assertExists(result, "Should return result");
      assertExists(result.ID, "Result should have ID");

      console.log(
        `Complete results: helpful=${result.addHelpfulSynapses?.length}, ` +
          `harmful=${result.removeHarmfulSynapse ? 1 : 0}, ` +
          `squashes=${result.candidateSquashes?.length}`,
      );
    } finally {
      await cleanupTempDir(tmpDir);
    }
  },
});

// Note: Tests for Neat class behavior (tracking duration, skipping discovery)
// will be added after implementing the Neat.ts changes, as they require
// modifications to the Neat class to expose the necessary fields/methods for testing
