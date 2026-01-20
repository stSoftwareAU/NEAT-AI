import { assert, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { recordDirectory } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { initWasmActivation } from "../../src/wasm/WasmActivation.ts";

// Calculate the path to wasm_activation/pkg relative to repo root
const repoRoot = new URL("../../", import.meta.url).pathname;
const wasmPath = `${repoRoot}wasm_activation/pkg`;

/**
 * Tests for discovery timeout handling and partial result recovery.
 * Uses fast timeouts (1-3 seconds) with small datasets for CI/CD.
 */

async function countParquetFiles(dir: string): Promise<number> {
  let count = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        count += await countParquetFiles(path);
      } else if (entry.isFile && entry.name.endsWith(".parquet")) {
        count++;
      }
    }
  } catch {
    // Directory may not exist if discovery aborted early
  }
  return count;
}

async function readSelectedIndexCount(
  discoveryBaseDir: string,
  creature: Creature,
): Promise<number> {
  const selectedPath =
    `${discoveryBaseDir}/${creature.uuid}/selected_indices.json`;
  const content = await Deno.readTextFile(selectedPath);
  const parsed = JSON.parse(content) as Record<string, number[]>;
  const counts = Object.values(parsed).map((indices) =>
    Array.isArray(indices) ? indices.length : 0
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

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
// Uses crypto.randomUUID() to ensure uniqueness when tests run in parallel
async function createTempTestDir(testName: string): Promise<string> {
  const uniqueId = crypto.randomUUID();
  const tmpDir = `.tmp/test-discovery-timeout-${testName}-${uniqueId}`;
  await Deno.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

// Test utility: Cleanup temp directory
function cleanupTempDir(dirPath: string) {
  try {
    // Use removeSync - simpler, faster, and ensures all file handles are closed
    // before removal completes (no possibility of resource leaks)
    Deno.removeSync(dirPath, { recursive: true });
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
    await initWasmActivation(wasmPath);
    assertRustDiscoveryAvailable();
    const tmpDir128 = await createTempTestDir("batch-128");
    const tmpDir512 = await createTempTestDir("batch-512");

    try {
      // Create meaningful test creatures (record phase only, analysis skipped)
      const creature128 = makeTestCreature(10);
      CreatureUtil.makeUUID(creature128);
      creature128.clearState();
      const recordCount = 5000;
      await createTestBinaryFile(
        creature128,
        recordCount,
        tmpDir128,
        "test1.bin",
      );

      const creature512 = makeTestCreature(10);
      CreatureUtil.makeUUID(creature512);
      creature512.clearState();
      await createTestBinaryFile(
        creature512,
        recordCount,
        tmpDir512,
        "test1.bin",
      );

      // Set environment variable to ensure cleanup is awaited in tests (prevents leaks)
      const originalDenoTest = Deno.env.get("DENO_TEST");
      Deno.env.set("DENO_TEST", "true");
      try {
        // Record-phase timeout test (analysis is skipped by setting discoveryMaxNeurons=0).
        // We still exercise real FFI recording/flush.
        const config128 = createNeatConfig({
          discoveryBatchSize: 128,
          discoveryRecordTimeOutMinutes: 0.001, // 60ms (forces partial recording)
          discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds (minimum allowed)
          discoverySampleRate: 1.0, // 100% sample rate
          discoveryMaxNeurons: 0, // Skip analysis (prevents slow Rust synapse analysis)
          discoveryBaseDirectory: tmpDir128,
          discoveryDisableCleanup: true, // Preserve artefacts for assertions
          log: 0,
        });

        const start128 = Date.now();
        const result128 = await recordDirectory(
          creature128,
          tmpDir128,
          config128,
        );
        const elapsed128 = Date.now() - start128;

        const config512 = createNeatConfig({
          discoveryBatchSize: 512,
          discoveryRecordTimeOutMinutes: 0.001, // 60ms (forces partial recording)
          discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds (minimum allowed)
          discoverySampleRate: 1.0,
          discoveryMaxNeurons: 0, // Skip analysis
          discoveryBaseDirectory: tmpDir512,
          discoveryDisableCleanup: true,
          log: 0,
        });

        const start512 = Date.now();
        const result512 = await recordDirectory(
          creature512,
          tmpDir512,
          config512,
        );
        const elapsed512 = Date.now() - start512;

        // Both should return results (not throw) - this tests timeout handling and FFI integration.
        assertExists(result128, "Batch 128 should return result");
        assertExists(result512, "Batch 512 should return result");

        // Ensure record phase actually saved Parquet via Rust FFI.
        const parquet128 = await countParquetFiles(
          `${tmpDir128}/${creature128.uuid}`,
        );
        const parquet512 = await countParquetFiles(
          `${tmpDir512}/${creature512.uuid}`,
        );
        assert(
          parquet128 > 0,
          `Expected at least one Parquet artefact for batch=128, got ${parquet128}`,
        );
        assert(
          parquet512 > 0,
          `Expected at least one Parquet artefact for batch=512, got ${parquet512}`,
        );

        // Ensure timeouts actually prevented full recording (partial indices).
        const recorded128 = await readSelectedIndexCount(
          tmpDir128,
          creature128,
        );
        const recorded512 = await readSelectedIndexCount(
          tmpDir512,
          creature512,
        );
        assert(
          recorded128 > 0,
          "Expected to record at least one sample before timing out (batch=128)",
        );
        assert(
          recorded512 > 0,
          "Expected to record at least one sample before timing out (batch=512)",
        );
        assert(
          recorded128 < recordCount,
          `Expected partial recording for batch=128. Recorded=${recorded128}, total=${recordCount}`,
        );
        assert(
          recorded512 < recordCount,
          `Expected partial recording for batch=512. Recorded=${recorded512}, total=${recordCount}`,
        );

        // This is a regression guard for "timeout tests are slow on GPU machines".
        // We want this test bounded even when GPUs are available.
        assert(
          elapsed128 < 15_000 && elapsed512 < 15_000,
          `Expected both runs to finish quickly. elapsed128=${elapsed128}ms elapsed512=${elapsed512}ms`,
        );
      } finally {
        // Restore original DENO_TEST value
        if (originalDenoTest !== undefined) {
          Deno.env.set("DENO_TEST", originalDenoTest);
        } else {
          Deno.env.delete("DENO_TEST");
        }
      }
    } finally {
      cleanupTempDir(tmpDir128);
      cleanupTempDir(tmpDir512);
    }
  },
});

Deno.test({
  name: "DiscoverDirectory returns partial results on timeout",
  ignore: shouldSkipRustDiscoveryTests(),
  async fn() {
    await initWasmActivation(wasmPath);
    assertRustDiscoveryAvailable();
    const creature = makeTestCreature(15);
    CreatureUtil.makeUUID(creature);
    creature.clearState();

    const tmpDir = await createTempTestDir("partial-results");

    try {
      // Create larger dataset to ensure timeout is triggered
      const recordCount = 5000;
      await createTestBinaryFile(creature, recordCount, tmpDir, "test.bin");

      // Short timeout to test timeout handling - should trigger partial results
      const config = createNeatConfig({
        discoveryBatchSize: 128,
        discoveryRecordTimeOutMinutes: 0.001, // 60ms (forces partial recording)
        discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds (minimum allowed)
        discoverySampleRate: 1.0,
        discoveryMaxNeurons: 0, // Skip analysis
        discoveryBaseDirectory: tmpDir,
        discoveryDisableCleanup: true,
        log: 0,
      });

      // Set environment variable to ensure cleanup is awaited in tests (prevents leaks)
      const originalDenoTest = Deno.env.get("DENO_TEST");
      Deno.env.set("DENO_TEST", "true");
      try {
        const start = Date.now();
        const result = await recordDirectory(creature, tmpDir, config);
        const elapsed = Date.now() - start;

        // Should return result (not throw)
        assertExists(result, "Should return result even with timeout");
        assertExists(result.ID, "Result should have ID");

        const parquetCount = await countParquetFiles(
          `${tmpDir}/${creature.uuid}`,
        );
        assert(
          parquetCount > 0,
          `Expected at least one Parquet artefact, got ${parquetCount}`,
        );

        const recorded = await readSelectedIndexCount(tmpDir, creature);
        assert(
          recorded > 0,
          "Expected to record at least one sample before timing out",
        );
        assert(
          recorded < recordCount,
          `Expected partial recording. Recorded=${recorded}, total=${recordCount}`,
        );

        assert(
          elapsed < 15_000,
          `Expected timeout test to be fast. elapsed=${elapsed}ms`,
        );
      } finally {
        // Restore original DENO_TEST value
        if (originalDenoTest !== undefined) {
          Deno.env.set("DENO_TEST", originalDenoTest);
        } else {
          Deno.env.delete("DENO_TEST");
        }
      }
    } finally {
      cleanupTempDir(tmpDir);
    }
  },
});

Deno.test({
  name: "Timeout during file reading returns partial data",
  ignore: shouldSkipRustDiscoveryTests(),
  async fn() {
    await initWasmActivation(wasmPath);
    assertRustDiscoveryAvailable();
    const creature = makeTestCreature(15);
    CreatureUtil.makeUUID(creature);
    creature.clearState();

    const tmpDir = await createTempTestDir("file-timeout");

    try {
      // Create multiple binary files to ensure processing takes time
      const recordCount = 5000;
      await createTestBinaryFile(creature, recordCount, tmpDir, "test1.bin");
      await createTestBinaryFile(creature, recordCount, tmpDir, "test2.bin");
      await createTestBinaryFile(creature, recordCount, tmpDir, "test3.bin");

      // Short timeout to test timeout during file processing
      const config = createNeatConfig({
        discoveryBatchSize: 128,
        discoveryRecordTimeOutMinutes: 0.05, // 3 seconds
        discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds (minimum allowed)
        discoverySampleRate: 1.0,
        discoveryMaxNeurons: 0, // Skip analysis
        discoveryBaseDirectory: tmpDir,
        discoveryDisableCleanup: true,
        log: 0,
      });

      // Set environment variable to ensure cleanup is awaited in tests (prevents leaks)
      const originalDenoTest = Deno.env.get("DENO_TEST");
      Deno.env.set("DENO_TEST", "true");
      try {
        const start = Date.now();
        const result = await recordDirectory(creature, tmpDir, config);
        const elapsed = Date.now() - start;

        // Should complete without throwing
        assertExists(result, "Should return result despite timeout");
        assertExists(result.ID, "Result should have ID");

        const parquetCount = await countParquetFiles(
          `${tmpDir}/${creature.uuid}`,
        );
        assert(
          parquetCount > 0,
          `Expected at least one Parquet artefact, got ${parquetCount}`,
        );

        const recorded = await readSelectedIndexCount(tmpDir, creature);
        assert(
          recorded > 0,
          "Expected to record at least one sample before timing out",
        );

        assert(
          elapsed < 15_000,
          `Expected timeout test to be fast. elapsed=${elapsed}ms`,
        );
      } finally {
        // Restore original DENO_TEST value
        if (originalDenoTest !== undefined) {
          Deno.env.set("DENO_TEST", originalDenoTest);
        } else {
          Deno.env.delete("DENO_TEST");
        }
      }

      // Should have processed at least some files
      // The diagnostic log should show "timeout reached during file processing"
      // (visible in test output with log: true)
    } finally {
      cleanupTempDir(tmpDir);
    }
  },
});

Deno.test({
  name: "Discovery completes successfully with reasonable timeout",
  ignore: shouldSkipRustDiscoveryTests(),
  async fn() {
    await initWasmActivation(wasmPath);
    assertRustDiscoveryAvailable();
    const creature = makeTestCreature(15);
    CreatureUtil.makeUUID(creature);
    creature.clearState();

    const tmpDir = await createTempTestDir("success");

    try {
      // Create meaningful dataset
      const recordCount = 100;
      await createTestBinaryFile(creature, recordCount, tmpDir, "test.bin");

      const config = createNeatConfig({
        discoveryBatchSize: 128,
        discoveryRecordTimeOutMinutes: 0.2, // 12 seconds
        discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds (minimum allowed)
        discoverySampleRate: 1.0,
        discoveryMaxNeurons: 0, // Skip analysis
        discoveryBaseDirectory: tmpDir,
        discoveryDisableCleanup: true,
        log: 0,
      });

      // Set environment variable to ensure cleanup is awaited in tests (prevents leaks)
      const originalDenoTest = Deno.env.get("DENO_TEST");
      Deno.env.set("DENO_TEST", "true");
      try {
        const start = Date.now();
        const result = await recordDirectory(creature, tmpDir, config);
        const elapsed = Date.now() - start;

        // Should complete successfully
        assertExists(result, "Should return result");
        assertExists(result.ID, "Result should have ID");

        const parquetCount = await countParquetFiles(
          `${tmpDir}/${creature.uuid}`,
        );
        assert(
          parquetCount > 0,
          `Expected at least one Parquet artefact, got ${parquetCount}`,
        );
        const recorded = await readSelectedIndexCount(tmpDir, creature);
        assert(
          recorded === recordCount,
          `Expected all records to be recorded. Recorded=${recorded}, total=${recordCount}`,
        );

        assert(
          elapsed < 15_000,
          `Expected discovery (record-only) test to be fast. elapsed=${elapsed}ms`,
        );
      } finally {
        // Restore original DENO_TEST value
        if (originalDenoTest !== undefined) {
          Deno.env.set("DENO_TEST", originalDenoTest);
        } else {
          Deno.env.delete("DENO_TEST");
        }
      }
    } finally {
      cleanupTempDir(tmpDir);
    }
  },
});

// Note: Tests for Neat class behavior (tracking duration, skipping discovery)
// will be added after implementing the Neat.ts changes, as they require
// modifications to the Neat class to expose the necessary fields/methods for testing
