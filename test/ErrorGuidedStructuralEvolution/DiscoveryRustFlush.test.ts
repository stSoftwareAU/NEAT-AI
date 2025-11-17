import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { recordDirectory } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts";
import type { DiscoverStructureDeps } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  RustAnalyzeNeuronsResult,
  RustAnalyzeSynapsesResult,
  RustMergeParquetInput,
  RustMergeParquetResult,
  RustReadResult,
  RustRecordInput,
  RustRecordResult,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test("Discovery flushes Rust recording in configured chunks", async () => {
  const envKey = "NEAT_DISCOVERY_AWAIT_CLEANUP";
  const previousValue = (() => {
    try {
      return Deno.env.get(envKey);
    } catch {
      return undefined;
    }
  })();
  try {
    Deno.env.set(envKey, "1");
  } catch {
    // ignore if env not accessible
  }
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

    const options: NeatOptions = {
      costName: "MSE",
      costOfGrowth: 0,
      discoverySampleRate: 1,
      discoveryBatchSize: 1,
      discoveryTimeOutMinutes: 1,
      discoveryAnalysisTimeoutMinutes: 1,
      discoveryDrainEveryNBatches: 1,
      discoveryRustFlushRecords: 2,
      discoveryMaxNeurons: 1,
      threads: 1,
    };

    const recordCallSizes: number[] = [];
    const mergedChunks: string[][] = [];

    const deps: Partial<DiscoverStructureDeps> = {
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
      analyzeNeurons: (): RustAnalyzeNeuronsResult => ({ success: true }),
      analyzeSynapses: (): RustAnalyzeSynapsesResult => ({
        success: true,
        helpfulSynapses: [],
        harmfulSynapses: [],
      }),
      readDiscoveryRecords: (): RustReadResult => ({
        success: true,
        records: [],
      }),
    };

    await recordDirectory(creature, tempDir, options, deps);
    // Allow asynchronous cleanup triggered by recordDirectory to complete.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(recordCallSizes, [2, 2]);
    assertEquals(mergedChunks.length, 1);
    assertEquals(mergedChunks[0].length, 2);
  } finally {
    if (previousValue === undefined) {
      try {
        Deno.env.delete(envKey);
      } catch {
        // ignore
      }
    } else {
      try {
        Deno.env.set(envKey, previousValue);
      } catch {
        // ignore
      }
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});
