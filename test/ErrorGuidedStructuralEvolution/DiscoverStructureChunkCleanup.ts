import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import type {
  RustMergeParquetInput,
  RustMergeParquetResult,
  RustParallelAnalysisResult,
  RustReadResult,
  RustRecordInput,
  RustRecordResult,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { DiscoverStructureDeps } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeMinimalCreature(): Creature {
  const exportJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.75 },
    ],
  };

  const creature = Creature.fromJSON(exportJSON);
  CreatureUtil.makeUUID(creature);
  creature.validate();
  return creature;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function makeTwoSamples(): DataRecordInterface[] {
  return [
    { input: Float32Array.from([0.1]), output: Float32Array.from([0.2]) },
    { input: Float32Array.from([0.3]), output: Float32Array.from([0.4]) },
  ];
}

Deno.test({
  name: "flushRustRecording cleans up chunk files and directories after merge",
  permissions: {
    read: true,
    write: true,
    ffi: false,
  },
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const baseDir = await Deno.makeTempDir({ prefix: "neat-discovery-clean-" });
    const creature = makeMinimalCreature();

    const createdChunkFiles: string[] = [];
    const createdChunkDirs: string[] = [];

    const deps: Partial<DiscoverStructureDeps> = {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (input: RustRecordInput): RustRecordResult => {
        const file = `chunk-${createdChunkFiles.length + 1}.parquet`;
        const chunkFile = `${input.temp_dir}/${file}`;
        Deno.writeTextFileSync(chunkFile, "placeholder");
        createdChunkFiles.push(chunkFile);
        createdChunkDirs.push(input.temp_dir);
        return { success: true, temp_dir: input.temp_dir, file };
      },
      mergeDiscoveryParquet: (
        input: RustMergeParquetInput,
      ): RustMergeParquetResult => {
        Deno.writeTextFileSync(input.outputFile, "merged");
        return { success: true, outputFile: input.outputFile };
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

    const discovery = new DiscoverStructure(
      creature,
      60,
      1, // flush every record batch to create multiple chunks deterministically
      deps,
      { baseDirectory: baseDir },
    );

    const neuronPromises = new Map<string, Promise<void>>();
    discovery.initialize(neuronPromises);

    const samples = makeTwoSamples();
    assertEquals(
      discovery.record([samples[0]], neuronPromises, "/tmp/fake.bin", [0]),
      true,
    );
    assertEquals(discovery.flushRustChunk(), true);

    assertEquals(
      discovery.record([samples[1]], neuronPromises, "/tmp/fake.bin", [1]),
      true,
    );
    assertEquals(discovery.flushRustChunk(), true);

    // Sanity: chunk files are present before merge cleanup.
    assertEquals(await pathExists(createdChunkFiles[0]), true);
    assertEquals(await pathExists(createdChunkFiles[1]), true);

    assertEquals(discovery.flushRustRecording(), true);

    // Post-merge cleanup should remove chunk files and their directories.
    assertEquals(await pathExists(createdChunkFiles[0]), false);
    assertEquals(await pathExists(createdChunkFiles[1]), false);
    assertEquals(await pathExists(createdChunkDirs[0]), false);
    assertEquals(await pathExists(createdChunkDirs[1]), false);

    await discovery.cleanUp();
    try {
      // deno-lint-ignore no-sync-fn-in-async-fn
      Deno.removeSync(baseDir, { recursive: true });
    } catch {
      // ignore
    }
  },
});

Deno.test({
  name: "flushRustRecording preserves chunk files when cleanup is disabled",
  permissions: {
    read: true,
    write: true,
    ffi: false,
  },
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const baseDir = await Deno.makeTempDir({ prefix: "neat-discovery-keep-" });
    const creature = makeMinimalCreature();

    const createdChunkFiles: string[] = [];
    const createdChunkDirs: string[] = [];

    const deps: Partial<DiscoverStructureDeps> = {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (input: RustRecordInput): RustRecordResult => {
        const file = `chunk-${createdChunkFiles.length + 1}.parquet`;
        const chunkFile = `${input.temp_dir}/${file}`;
        Deno.writeTextFileSync(chunkFile, "placeholder");
        createdChunkFiles.push(chunkFile);
        createdChunkDirs.push(input.temp_dir);
        return { success: true, temp_dir: input.temp_dir, file };
      },
      mergeDiscoveryParquet: (
        input: RustMergeParquetInput,
      ): RustMergeParquetResult => {
        Deno.writeTextFileSync(input.outputFile, "merged");
        return { success: true, outputFile: input.outputFile };
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

    const discovery = new DiscoverStructure(
      creature,
      60,
      1,
      deps,
      { baseDirectory: baseDir, disableCleanup: true },
    );

    const neuronPromises = new Map<string, Promise<void>>();
    discovery.initialize(neuronPromises);

    const samples = makeTwoSamples();
    assertEquals(
      discovery.record([samples[0]], neuronPromises, "/tmp/fake.bin", [0]),
      true,
    );
    assertEquals(discovery.flushRustChunk(), true);

    assertEquals(
      discovery.record([samples[1]], neuronPromises, "/tmp/fake.bin", [1]),
      true,
    );
    assertEquals(discovery.flushRustChunk(), true);

    assertEquals(discovery.flushRustRecording(), true);

    // Cleanup disabled - chunk files/dirs should still exist.
    assertEquals(await pathExists(createdChunkFiles[0]), true);
    assertEquals(await pathExists(createdChunkFiles[1]), true);
    assertEquals(await pathExists(createdChunkDirs[0]), true);
    assertEquals(await pathExists(createdChunkDirs[1]), true);

    await discovery.cleanUp();
    try {
      // deno-lint-ignore no-sync-fn-in-async-fn
      Deno.removeSync(baseDir, { recursive: true });
    } catch {
      // ignore
    }
  },
});
