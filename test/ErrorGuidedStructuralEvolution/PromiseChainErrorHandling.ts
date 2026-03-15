import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Tests for promise chain error handling in discovery.
 * Verifies that file write errors don't cause deadlocks.
 */

function makeStubDeps() {
  return {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: (input: { temp_dir: string }) => ({
      success: true,
      file: `${input.temp_dir}/chunk.parquet`,
    }),
    mergeDiscoveryParquet: (input: { outputFile: string }) => ({
      success: true,
      outputFile: input.outputFile,
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
  };
}

function makeSimpleCreature(): Creature {
  const json: CreatureExport = {
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
      { weight: 1.0, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 1.0, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test({
  name: "Discovery record and flush completes all promises without deadlocking",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await initWasmForTests();
    const creature = makeSimpleCreature();
    CreatureUtil.makeUUID(creature);

    const discoverStructure = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
      makeStubDeps(),
    );

    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);

    const testData: DataRecordInterface[] = [
      { input: new Float32Array([1.0]), output: new Float32Array([0.5]) },
      { input: new Float32Array([2.0]), output: new Float32Array([1.0]) },
    ];

    const recorded = discoverStructure.record(testData, neuronPromisesMap);
    assert(recorded, "Record should succeed");

    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // Await all promises directly — if a deadlock occurs the test runner's
    // own timeout will catch it rather than relying on an in-test timer.
    await Promise.all([...neuronPromisesMap.values()]);

    await discoverStructure.cleanUp();
  },
});
