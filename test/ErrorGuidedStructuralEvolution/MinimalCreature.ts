import { assert, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { Creature } from "../../src/Creature.ts";
import { DEFAULT_COST_OF_GROWTH } from "../../src/config/NeatConfig.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

/**
 * Test discovery with minimal valid creatures to ensure edge cases are handled.
 */

Deno.test({
  name: "Discovery handles minimal creature (1 input, 1 output)",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    // Create the smallest valid creature
    const json: CreatureExport = {
      neurons: [
        {
          type: "output",
          uuid: "output-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      ],
      input: 1,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const trainingData = [];
    for (let i = 0; i < 20; i++) {
      const input = new Float32Array([Math.random() * 2 - 1]);
      const output = new Float32Array([Math.random() * 2 - 1]);
      trainingData.push({ input, output });
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

    // Should handle minimal creature without errors
    const viableNeurons = await discoverStructure.listViableNeurons();
    assertExists(viableNeurons, "Should return viable neurons list");

    // With only 1 non-input neuron, should return at most 1
    assert(
      viableNeurons.length <= 1,
      `Should have at most 1 neuron, got ${viableNeurons.length}`,
    );

    // Selection should handle requesting more neurons than exist
    const selected = await discoverStructure.selectNeuronsWeightedByError(
      6,
      DEFAULT_COST_OF_GROWTH,
    );
    assertExists(selected, "Should return selection");
    assert(
      selected.length <= 1,
      `Should select at most 1 neuron when only 1 exists, got ${selected.length}`,
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery handles small creature (2 inputs, 1 hidden, 1 output)",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
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
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
        { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.5 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const trainingData = [];
    for (let i = 0; i < 30; i++) {
      const input = new Float32Array([
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ]);
      const output = new Float32Array([Math.random() * 2 - 1]);
      trainingData.push({ input, output });
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
    assertExists(viableNeurons, "Should return viable neurons list");
    assert(
      viableNeurons.length <= 2,
      `Should have at most 2 neurons, got ${viableNeurons.length}`,
    );

    // Request more neurons than exist (6 > 2)
    const selected = await discoverStructure.selectNeuronsWeightedByError(
      6,
      DEFAULT_COST_OF_GROWTH,
    );
    assertExists(selected, "Should return selection");
    assert(
      selected.length <= 2,
      `Should select at most 2 neurons when only 2 exist, got ${selected.length}`,
    );

    // Analyze should handle small creatures
    const analysisResult = await discoverStructure.analyze(
      6,
      DEFAULT_COST_OF_GROWTH,
    );
    // May return undefined or array depending on if it finds candidates
    assert(
      analysisResult === undefined || Array.isArray(analysisResult),
      "Analysis should complete without errors",
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery selection respects neuron count limit",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable leak detection - Rust FFI library load/unload is expected
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();
    // Create creature with exactly 3 non-input neurons
    const json: CreatureExport = {
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-0",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "hidden-1",
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
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
        { fromUUID: "input-1", toUUID: "hidden-1", weight: 1.0 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      ],
      input: 3,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const trainingData = [];
    for (let i = 0; i < 30; i++) {
      const input = new Float32Array([
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ]);
      const output = new Float32Array([Math.random() * 2 - 1]);
      trainingData.push({ input, output });
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

    // Request 10 neurons when only 3 exist
    const selected = await discoverStructure.selectNeuronsWeightedByError(
      10,
      DEFAULT_COST_OF_GROWTH,
    );
    assertExists(selected, "Should return selection");
    assert(
      selected.length === 3,
      `Should select exactly 3 neurons when only 3 exist, got ${selected.length}`,
    );

    // Verify all selected neurons are unique
    const uniqueSelected = new Set(selected);
    assert(
      uniqueSelected.size === selected.length,
      "All selected neurons should be unique",
    );

    await discoverStructure.cleanUp();
  },
});
