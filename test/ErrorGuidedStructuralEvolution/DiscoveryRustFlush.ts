import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { recordDirectory } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  RustMergeParquetInput,
  RustMergeParquetResult,
  RustParallelAnalysisResult,
  RustReadResult,
  RustRecordInput,
  RustRecordResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Await the recorder's cleanup so no temp-dir removal outlives the test.
 * Injected rather than set on the process, whose environment every file under
 * `deno test --parallel` shares (Issue #4034).
 */
const awaitCleanupEnv = {
  get: (key: string) =>
    key === "NEAT_DISCOVERY_AWAIT_CLEANUP" ? "1" : undefined,
};

Deno.test("Discovery flushes Rust recording in configured chunks", async () => {
  await initWasmForTests();
  const tempDir = await Deno.makeTempDir({ prefix: "discovery-chunk-test-" });
  try {
    const dataFile = join(tempDir, "sample.bin");
    const recordCount = 4;
    const valuesPerRecord = 2; // input + output
    const buffer = new Float32Array(recordCount * valuesPerRecord);

    for (let i = 0; i < recordCount; i++) {
      buffer[i * valuesPerRecord] = i;
      buffer[i * valuesPerRecord + 1] = i * 2;
    }

    await Deno.writeFile(dataFile, new Uint8Array(buffer.buffer));

    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      ],
    });
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const config = createNeatConfig({
      costName: "MSE",
      costOfGrowth: 0,
      discoverySampleRate: 1,
      discoveryBatchSize: 1,
      discoveryRecordTimeOutMinutes: 0.05, // 3 seconds - sufficient for CI
      discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds - sufficient for CI
      discoveryDrainEveryNBatches: 1,
      discoveryRustFlushRecords: 2,
      discoveryMaxNeurons: 1,
      threads: 1,
      log: 0,
    });

    const recordCallSizes: number[] = [];
    const mergedChunks: string[][] = [];

    const deps: Partial<DiscoverStructureDeps> = {
      env: awaitCleanupEnv,
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (
        input: RustRecordInput,
      ): RustRecordResult => {
        recordCallSizes.push(input.training_data.length);
        const chunkFile = join(
          input.temp_dir,
          `chunk-${recordCallSizes.length}.parquet`,
        );
        Deno.writeTextFileSync(chunkFile, "placeholder");
        return {
          success: true,
          temp_dir: input.temp_dir,
          file: `chunk-${recordCallSizes.length}.parquet`,
        };
      },
      mergeDiscoveryParquet: (
        input: RustMergeParquetInput,
      ): RustMergeParquetResult => {
        mergedChunks.push([...input.inputFiles]);
        Deno.writeTextFileSync(input.outputFile, "merged");
        return {
          success: true,
          outputFile: input.outputFile,
        };
      },
      analyzeParallel: (): RustParallelAnalysisResult => ({
        success: true,
        helpfulNeurons: [],
        helpfulSynapses: [],
        harmfulSynapses: [],
      }),
      readDiscoveryRecords: (): RustReadResult => ({
        success: true,
        records: [],
      }),
    };

    await recordDirectory(creature, tempDir, config, deps);
    // Cleanup is already awaited: the injected env sets NEAT_DISCOVERY_AWAIT_CLEANUP

    assertEquals(recordCallSizes, [2, 2]);
    assertEquals(mergedChunks.length, 1);
    assertEquals(mergedChunks[0].length, 2);
  } finally {
    // Use removeSync - simpler, faster, and ensures all file handles are closed
    try {
      // deno-lint-ignore no-sync-fn-in-async-fn
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("Discovery flushes Rust recording based on estimated payload size", async () => {
  await initWasmForTests();
  const tempDir = await Deno.makeTempDir({ prefix: "discovery-byte-flush-" });
  try {
    const dataFile = join(tempDir, "sample.bin");
    const recordCount = 4;
    const valuesPerRecord = 2; // input + output
    const buffer = new Float32Array(recordCount * valuesPerRecord);

    for (let i = 0; i < recordCount; i++) {
      buffer[i * valuesPerRecord] = i;
      buffer[i * valuesPerRecord + 1] = i * 2;
    }

    await Deno.writeFile(dataFile, new Uint8Array(buffer.buffer));

    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      ],
    });
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const config = createNeatConfig({
      costName: "MSE",
      costOfGrowth: 0,
      discoverySampleRate: 1,
      discoveryBatchSize: 1,
      discoveryRecordTimeOutMinutes: 0.05, // 3 seconds - sufficient for CI
      discoveryAnalysisTimeoutMinutes: 0.05, // 3 seconds - sufficient for CI
      discoveryDrainEveryNBatches: 1,
      discoveryRustFlushRecords: 1_000_000, // ensure bytes trigger the flush
      discoveryRustFlushBytes: 300, // smaller than 1-sample estimate for this creature
      discoveryMaxNeurons: 1,
      threads: 1,
      log: 0,
    });

    const recordCallSizes: number[] = [];
    const mergedChunks: string[][] = [];

    const deps: Partial<DiscoverStructureDeps> = {
      env: awaitCleanupEnv,
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (input: RustRecordInput): RustRecordResult => {
        recordCallSizes.push(input.training_data.length);
        const chunkFile = join(
          input.temp_dir,
          `chunk-${recordCallSizes.length}.parquet`,
        );
        Deno.writeTextFileSync(chunkFile, "placeholder");
        return {
          success: true,
          temp_dir: input.temp_dir,
          file: `chunk-${recordCallSizes.length}.parquet`,
        };
      },
      mergeDiscoveryParquet: (
        input: RustMergeParquetInput,
      ): RustMergeParquetResult => {
        mergedChunks.push([...input.inputFiles]);
        Deno.writeTextFileSync(input.outputFile, "merged");
        return {
          success: true,
          outputFile: input.outputFile,
        };
      },
      analyzeParallel: (): RustParallelAnalysisResult => ({
        success: true,
        helpfulNeurons: [],
        helpfulSynapses: [],
        harmfulSynapses: [],
      }),
      readDiscoveryRecords: (): RustReadResult => ({
        success: true,
        records: [],
      }),
    };

    await recordDirectory(creature, tempDir, config, deps);
    // Cleanup is already awaited: the injected env sets NEAT_DISCOVERY_AWAIT_CLEANUP

    assertEquals(recordCallSizes, [1, 1, 1, 1]);
    assertEquals(mergedChunks.length, 1);
    assertEquals(mergedChunks[0].length, 4);
  } finally {
    try {
      // deno-lint-ignore no-sync-fn-in-async-fn
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
