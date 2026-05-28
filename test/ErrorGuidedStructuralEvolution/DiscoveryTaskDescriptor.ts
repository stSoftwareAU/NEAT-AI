/**
 * Tests for sending the cost {@link TaskDescriptor} on the discovery wire
 * (Issue #2785).
 *
 * Verifies that the structural cost descriptor is attached to both the
 * `recordDiscovery` and `analyzeParallel` payloads, that built-in costs send
 * their canonical name, and that custom/unknown costs collapse to the neutral
 * `OTHER` descriptor so the real custom name never leaves the process.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { ensureRustCombinedAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type {
  RustParallelAnalysisInput,
  RustRecordInput,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import {
  costNameToTaskDescriptor,
  OTHER_COST_NAME,
  OTHER_TASK_DESCRIPTOR,
  type TaskDescriptor,
} from "@costs/CostTaskDescriptor.ts";
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

function makeTrainingRecords(count: number): {
  trainingRecords: DataRecordInterface[];
  rawIndices: number[];
} {
  const trainingRecords: DataRecordInterface[] = [];
  const rawIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    trainingRecords.push({
      input: Float32Array.from([i / 10, (i + 1) / 10]),
      output: Float32Array.from([i / 5]),
    });
    rawIndices.push(i);
  }
  return { trainingRecords, rawIndices };
}

Deno.test("recordDiscovery carries the configured cost task descriptor (Issue #2785)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const recordedInputs: RustRecordInput[] = [];
  const crossEntropyDescriptor = costNameToTaskDescriptor("CROSS_ENTROPY");

  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (input) => {
        recordedInputs.push(input);
        return { success: true, file: "chunk.parquet" };
      },
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => ({ success: true }),
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    { taskDescriptor: crossEntropyDescriptor },
  );

  const neuronPromises = new Map<number, Promise<void>>();
  try {
    structure.initialize(neuronPromises);
    const { trainingRecords, rawIndices } = makeTrainingRecords(5);
    assert(
      structure.record(
        trainingRecords,
        neuronPromises,
        "/tmp/fake.bin",
        rawIndices,
      ),
      "record call should succeed",
    );
    assertEquals(structure.flushRustChunk(), true, "flush should succeed");

    assertEquals(
      recordedInputs.length,
      1,
      "recordDiscovery should be invoked once",
    );
    assertEquals(
      recordedInputs[0].taskDescriptor,
      crossEntropyDescriptor,
      "recordDiscovery should send the configured descriptor",
    );
    assertEquals(
      recordedInputs[0].taskDescriptor?.costName,
      "CROSS_ENTROPY",
      "built-in cost sends its canonical name",
    );
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("recordDiscovery defaults to the neutral OTHER descriptor when no cost is configured (Issue #2785)", async () => {
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
        return { success: true, file: "chunk.parquet" };
      },
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: () => ({ success: true }),
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    // No taskDescriptor option supplied.
  );

  const neuronPromises = new Map<number, Promise<void>>();
  try {
    structure.initialize(neuronPromises);
    const { trainingRecords, rawIndices } = makeTrainingRecords(3);
    assert(
      structure.record(
        trainingRecords,
        neuronPromises,
        "/tmp/fake.bin",
        rawIndices,
      ),
      "record call should succeed",
    );
    assertEquals(structure.flushRustChunk(), true);

    assertEquals(
      recordedInputs[0].taskDescriptor,
      OTHER_TASK_DESCRIPTOR,
      "missing cost defaults to the neutral OTHER descriptor",
    );
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("analyzeParallel carries the configured cost task descriptor (Issue #2785)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const recordedInputs: RustRecordInput[] = [];
  const analyzeInputs: RustParallelAnalysisInput[] = [];
  const mseDescriptor = costNameToTaskDescriptor("MSE");

  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    {
      isRustDiscoveryEnabled: () => true,
      isRustLibraryAvailable: () => true,
      recordDiscovery: (input) => {
        recordedInputs.push(input);
        return { success: true, file: "chunk.parquet" };
      },
      mergeDiscoveryParquet: () => ({
        success: true,
        outputFile: "merged.parquet",
      }),
      analyzeParallel: (input) => {
        analyzeInputs.push(input);
        return { success: true, helpfulNeurons: [], helpfulSynapses: [] };
      },
      readDiscoveryRecords: () => ({ success: true, records: [] }),
    },
    { taskDescriptor: mseDescriptor },
  );

  const neuronPromises = new Map<number, Promise<void>>();
  try {
    structure.initialize(neuronPromises);
    const { trainingRecords, rawIndices } = makeTrainingRecords(5);
    assert(
      structure.record(
        trainingRecords,
        neuronPromises,
        "/tmp/fake.bin",
        rawIndices,
      ),
    );
    assertEquals(
      structure.flushRustRecording(),
      true,
      "recording should merge",
    );

    const outputNeuron = creature.neurons.find((n) => n.type === "output");
    assert(outputNeuron, "creature should have an output neuron");

    structure.ensureRustCombinedAnalysis([outputNeuron.id], true, true);

    assertEquals(
      analyzeInputs.length,
      1,
      "analyzeParallel should be invoked once",
    );
    assertEquals(
      analyzeInputs[0].taskDescriptor,
      mseDescriptor,
      "analyzeParallel should send the configured descriptor",
    );
    assertEquals(analyzeInputs[0].taskDescriptor?.costName, "MSE");
  } finally {
    await structure.cleanUp();
  }
});

Deno.test("ensureRustCombinedAnalysis never leaks a custom cost name, sending OTHER instead (Issue #2785)", () => {
  const creature = makeCreature();
  // A custom JS cost maps to the neutral OTHER descriptor via the helper.
  const customDescriptor = costNameToTaskDescriptor("my-secret-custom-cost");
  assertEquals(
    customDescriptor.costName,
    OTHER_COST_NAME,
    "custom cost must collapse to OTHER before reaching the wire",
  );

  let capturedInput: RustParallelAnalysisInput | undefined;
  const deps = {
    isRustDiscoveryEnabled: () => true,
    analyzeParallel: (input: RustParallelAnalysisInput) => {
      capturedInput = input;
      return { success: true, helpfulNeurons: [], helpfulSynapses: [] };
    },
  };

  const outputNeuron = creature.neurons.find((n) => n.type === "output");
  assert(outputNeuron);

  ensureRustCombinedAnalysis(
    creature,
    "/tmp/test.parquet",
    deps as unknown as Parameters<typeof ensureRustCombinedAnalysis>[2],
    undefined,
    undefined,
    [outputNeuron.id],
    true,
    true,
    () => {},
    undefined,
    customDescriptor,
  );

  assert(capturedInput, "analyzeParallel should have been called");
  const sent: TaskDescriptor | undefined = capturedInput.taskDescriptor;
  assertEquals(sent?.costName, OTHER_COST_NAME);
  // The raw custom name must not appear anywhere in the serialised payload.
  assert(
    !JSON.stringify(capturedInput).includes("my-secret-custom-cost"),
    "the real custom cost name must never be sent",
  );
});

Deno.test("analyzeParallel omits the descriptor when none is supplied (backward compatible) (Issue #2785)", () => {
  const creature = makeCreature();
  let capturedInput: RustParallelAnalysisInput | undefined;
  const deps = {
    isRustDiscoveryEnabled: () => true,
    analyzeParallel: (input: RustParallelAnalysisInput) => {
      capturedInput = input;
      return { success: true, helpfulNeurons: [], helpfulSynapses: [] };
    },
  };

  const outputNeuron = creature.neurons.find((n) => n.type === "output");
  assert(outputNeuron);

  ensureRustCombinedAnalysis(
    creature,
    "/tmp/test.parquet",
    deps as unknown as Parameters<typeof ensureRustCombinedAnalysis>[2],
    undefined,
    undefined,
    [outputNeuron.id],
    true,
    true,
    () => {},
    // no chunk deadline, no descriptor
  );

  assert(capturedInput, "analyzeParallel should have been called");
  assertEquals(
    "taskDescriptor" in capturedInput,
    false,
    "descriptor field stays absent on the wire when not supplied",
  );
});
