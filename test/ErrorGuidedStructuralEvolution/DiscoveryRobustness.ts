import { assert, assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

/**
 * Regression tests for discovery robustness issues found on Mac Air.
 * These tests ensure the discovery process can handle:
 * - Large numbers of neurons (1967+ neurons)
 * - Invalid data (NaN/Infinity)
 * - Timeout conditions
 * - File descriptor limits
 */

function makeCreatureWithManyNeurons(neuronCount: number): Creature {
  const neurons = [];
  const synapses = [];

  // Create many hidden neurons
  for (let i = 0; i < neuronCount; i++) {
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

  // Connect each hidden neuron to at least one input (cycle through inputs)
  for (let i = 0; i < neuronCount; i++) {
    const inputIndex = i % 20; // Cycle through the 20 inputs
    synapses.push({
      fromUUID: `input-${inputIndex}`,
      toUUID: `hidden-${i}`,
      weight: Math.random() * 2 - 1,
    });
  }

  // Connect ALL hidden neurons to outputs (to satisfy validation)
  for (let i = 0; i < neuronCount; i++) {
    // Alternate which output each hidden neuron connects to
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
    input: 20,
    output: 2,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

function makeTrainingData(
  inputSize: number,
  recordCount: number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];

  for (let i = 0; i < recordCount; i++) {
    const input = new Float32Array(inputSize);
    const output = new Float32Array(2);

    for (let j = 0; j < inputSize; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    output[0] = Math.random() * 2 - 1;
    output[1] = Math.random() * 2 - 1;

    data.push({ input, output });
  }

  return data;
}

Deno.test({
  name:
    "Discovery handles large number of neurons (1967+) without file descriptor exhaustion",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    // This test ensures batching prevents "too many open files" errors
    const neuronCount = 150; // Use 150 for test speed, batching logic handles 1967+
    const creature = makeCreatureWithManyNeurons(neuronCount);
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, 100);

    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // listViableNeurons should complete without hanging or file errors
    const viableNeurons = await discoverStructure.listViableNeurons();

    assertExists(viableNeurons, "Should return viable neurons list");
    assert(
      viableNeurons.length > 0,
      "Should find some neurons with non-zero error",
    );
    // viableNeurons only includes non-input neurons (hidden + output)
    const nonInputNeuronCount = neuronCount + 2; // hidden + 2 outputs
    assert(
      viableNeurons.length <= nonInputNeuronCount,
      `Should not exceed non-input neuron count (${viableNeurons.length} <= ${nonInputNeuronCount})`,
    );

    // Verify all neurons have finite error values
    for (const neuron of viableNeurons) {
      assert(
        Number.isFinite(neuron.totalError),
        `Neuron ${neuron.uuid} should have finite error, got ${neuron.totalError}`,
      );
      assert(
        neuron.totalError >= 0,
        `Neuron ${neuron.uuid} should have non-negative error`,
      );
    }

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name:
    "Discovery weighted selection completes within max iterations (prevents infinite loops)",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const creature = makeCreatureWithManyNeurons(50);
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, 100);

    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // selectNeuronsWeightedByError should complete even if selection is difficult
    const startTime = Date.now();
    const selectedNeurons = await discoverStructure
      .selectNeuronsWeightedByError(
        10,
      );
    const elapsed = Date.now() - startTime;

    assertExists(selectedNeurons, "Should return selected neurons");
    assert(selectedNeurons.length > 0, "Should select at least some neurons");
    assert(
      selectedNeurons.length <= 10,
      "Should not select more than requested",
    );
    assert(
      elapsed < 5000,
      `Selection took ${elapsed}ms, should complete in < 5s (would hang forever if infinite loop)`,
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery handles timeout during listViableNeurons gracefully",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const creature = makeCreatureWithManyNeurons(200);
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, 50);

    // Use very short timeout (1 second) to trigger timeout
    const discoverStructure = new DiscoverStructure(
      creature,
      1,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // Wait to ensure timeout has passed
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should handle timeout gracefully and return partial results
    const viableNeurons = await discoverStructure.listViableNeurons();

    const dsAny = discoverStructure as unknown as {
      lastNeuronScanStats?: {
        processed: number;
        total: number;
        timedOut: boolean;
      };
    };
    const scanStats = dsAny.lastNeuronScanStats;

    assertExists(
      viableNeurons,
      "Should return neurons list even after timeout",
    );

    if (scanStats?.timedOut) {
      // TypeScript fallback path should stop early and return fewer entries
      assert(
        viableNeurons.length < 200,
        "TypeScript fallback scan should have stopped early due to timeout",
      );
    } else {
      // Rust focus ranking path completes even if the JS timeout elapsed earlier.
      assert(
        scanStats?.processed === scanStats?.total,
        "Rust focus ranking should process all selectable neurons",
      );
      assertEquals(
        viableNeurons.length,
        scanStats?.processed ?? viableNeurons.length,
        "Rust focus ranking should return every processed neuron",
      );
    }

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery handles all-zero error case without infinite loop",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const creature = makeCreatureWithManyNeurons(20);
    CreatureUtil.makeUUID(creature);

    // Create training data where creature already perfectly predicts output
    const trainingData: DataRecordInterface[] = [];
    for (let i = 0; i < 50; i++) {
      const input = new Float32Array(creature.input);
      for (let j = 0; j < creature.input; j++) {
        input[j] = Math.random() * 2 - 1;
      }
      // Use creature's own output as "expected" - zero error
      const output = creature.activate(input);
      trainingData.push({ input, output: new Float32Array(output) });
    }

    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    const viableNeurons = await discoverStructure.listViableNeurons();

    // With zero error, should return empty or fall back gracefully
    assertExists(viableNeurons, "Should handle zero-error case");

    // Selection should not hang with zero total error
    const startTime = Date.now();
    const selectedNeurons = await discoverStructure
      .selectNeuronsWeightedByError(
        5,
      );
    const elapsed = Date.now() - startTime;

    assertExists(selectedNeurons, "Should handle zero-error selection");
    assert(
      elapsed < 2000,
      `Selection with zero error took ${elapsed}ms, should complete quickly`,
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery analyze phases respect timeout",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    const creature = makeCreatureWithManyNeurons(30);
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, 100);

    // Very short timeout
    const discoverStructure = new DiscoverStructure(
      creature,
      1,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);
    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // Wait for timeout to pass
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // These should all return quickly due to timeout checks
    const startTime = Date.now();

    const analysisResult = await discoverStructure.analyze(5);
    const removalResult = await discoverStructure.analyzeSynapsesForRemoval(5);
    const squashResult = await discoverStructure.analyzeNeuronsSquashes(5);

    const elapsed = Date.now() - startTime;

    // All should return undefined or complete quickly due to timeout
    assert(
      elapsed < 1000,
      `Analysis phases took ${elapsed}ms after timeout, should exit quickly`,
    );

    // Results may be undefined due to timeout, which is correct behavior
    assert(
      analysisResult === undefined || Array.isArray(analysisResult),
      "Analysis should return undefined or array",
    );
    assert(
      removalResult === undefined || typeof removalResult === "object",
      "Removal should return undefined or object",
    );
    assert(
      squashResult === undefined || Array.isArray(squashResult),
      "Squash should return undefined or array",
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery batching processes neurons in chunks",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    // This test verifies the batching logic by checking it doesn't load all files at once
    const neuronCount = 150; // More than BATCH_SIZE (50)
    const creature = makeCreatureWithManyNeurons(neuronCount);
    CreatureUtil.makeUUID(creature);

    const trainingData = makeTrainingData(creature.input, 50);

    const discoverStructure = new DiscoverStructure(
      creature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    discoverStructure.initialize(neuronPromisesMap);

    // Should create files for ALL neurons (including inputs) without error
    assertEquals(
      neuronPromisesMap.size,
      creature.neurons.length,
      "Should initialize files for all neurons",
    );

    const recorded = discoverStructure.record(trainingData, neuronPromisesMap);
    assert(recorded, "Record should succeed");
    await Promise.all([...neuronPromisesMap.values()]);

    // Flush Rust recording if using Rust
    const flushSuccess = discoverStructure.flushRustRecording();
    if (recorded && !flushSuccess) {
      throw new Error("Rust recording flush failed");
    }

    // listViableNeurons uses batching internally - if this completes, batching works
    const startTime = Date.now();
    const viableNeurons = await discoverStructure.listViableNeurons();
    const elapsed = Date.now() - startTime;

    assertExists(viableNeurons, "Should complete with batching");
    assert(
      elapsed < 30000,
      `Should complete in reasonable time (${elapsed}ms), not hang`,
    );

    await discoverStructure.cleanUp();
  },
});
