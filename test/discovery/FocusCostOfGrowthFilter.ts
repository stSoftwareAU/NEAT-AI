/**
 * Tests that focus selection filters out neurons where potentialErrorReduction < costOfGrowth
 *
 * This ensures we don't waste time analyzing neurons that can never improve the creature's score,
 * even if they perfectly eliminate all their error.
 *
 * Test created: 27-Nov-2025
 */

import { assert, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

Deno.test({
  name:
    "Discovery focus selection filters neurons below costOfGrowth threshold",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false, // Disable resource sanitization for Rust FFI
  sanitizeOps: false, // Disable ops sanitization for FFI operations
  fn: async () => {
    assertRustDiscoveryAvailable();

    // Create a creature with multiple hidden neurons to get varied impact levels
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
        { type: "hidden", uuid: "hidden-1", squash: TANH.NAME, bias: 0 },
        { type: "hidden", uuid: "hidden-2", squash: IDENTITY.NAME, bias: 0 },
        { type: "hidden", uuid: "hidden-3", squash: TANH.NAME, bias: 0 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
        { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
        { fromUUID: "input-2", toUUID: "hidden-2", weight: 0.3 },
        { fromUUID: "hidden-0", toUUID: "hidden-3", weight: 1.0 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.2 },
        { fromUUID: "hidden-3", toUUID: "output-0", weight: 1.0 },
      ],
      input: 3,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const trainingData = [];
    for (let i = 0; i < 50; i++) {
      const input = new Float32Array([
        Math.sin(i * 0.1),
        Math.cos(i * 0.1),
        (i % 3) / 3,
      ]);
      const output = new Float32Array([Math.sin(i * 0.2) * 0.5 + 0.5]);
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

    // Flush Rust recording
    const flushSuccess = discoverStructure.flushRustRecording();
    assert(flushSuccess, "Rust recording flush should succeed");

    // Get all viable neurons first
    const allViableNeurons = discoverStructure.listViableNeurons();
    assertExists(allViableNeurons, "Should have viable neurons");
    assert(
      allViableNeurons.length > 0,
      "Should have at least one viable neuron",
    );

    // Calculate potential error reduction for each neuron
    const neuronsWithPotential = allViableNeurons.map((n) => ({
      uuid: n.uuid,
      totalError: n.totalError,
      impact: n.impact,
      potentialErrorReduction: n.totalError * n.impact,
    }));

    // Test with a high cost of growth that should filter out low-impact neurons
    const highCostOfGrowth = 0.01;

    const selectedHigh = await discoverStructure.selectNeuronsWeightedByError(
      10,
      highCostOfGrowth,
    );

    // Verify that all selected neurons have potentialErrorReduction >= costOfGrowth
    for (const uuid of selectedHigh) {
      const neuronInfo = neuronsWithPotential.find((n) => n.uuid === uuid);
      assertExists(
        neuronInfo,
        `Selected neuron ${uuid} should be in viable list`,
      );

      assert(
        neuronInfo.potentialErrorReduction >= highCostOfGrowth,
        `Selected neuron ${uuid} has potentialErrorReduction ${neuronInfo.potentialErrorReduction} ` +
          `which is below costOfGrowth ${highCostOfGrowth}`,
      );
    }

    // Find neurons that should be filtered out
    const belowThreshold = neuronsWithPotential.filter(
      (n) => n.potentialErrorReduction < highCostOfGrowth,
    );

    if (belowThreshold.length > 0) {
      console.log(
        `✓ Correctly filtered ${belowThreshold.length} neurons below threshold`,
      );

      // Verify none of the below-threshold neurons were selected
      for (const neuron of belowThreshold) {
        assert(
          !selectedHigh.includes(neuron.uuid),
          `Neuron ${neuron.uuid} with potentialErrorReduction ${neuron.potentialErrorReduction} ` +
            `should not be selected when below costOfGrowth ${highCostOfGrowth}`,
        );
      }
    }

    // Test with a low cost of growth that should include more neurons
    const lowCostOfGrowth = 0.0001;

    const selectedLow = await discoverStructure.selectNeuronsWeightedByError(
      10,
      lowCostOfGrowth,
    );

    // With lower threshold, we should select at least as many neurons
    assert(
      selectedLow.length >= selectedHigh.length,
      `Lower costOfGrowth should select at least as many neurons: ` +
        `low=${selectedLow.length}, high=${selectedHigh.length}`,
    );

    await discoverStructure.cleanUp();
  },
});

Deno.test({
  name: "Discovery returns empty when all neurons below costOfGrowth threshold",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    assertRustDiscoveryAvailable();

    // Create a simple creature
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
        { type: "hidden", uuid: "hidden-1", squash: IDENTITY.NAME, bias: 0 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
        { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.1 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.1 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.1 },
      ],
      input: 2,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    // Record training data with very low variance to create low-impact neurons
    const trainingData = [];
    for (let i = 0; i < 20; i++) {
      // Very similar inputs and outputs to create low impact
      const input = new Float32Array([
        0.5 + Math.random() * 0.01,
        0.5 + Math.random() * 0.01,
      ]);
      const output = new Float32Array([0.5 + Math.random() * 0.01]);
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

    const flushSuccess = discoverStructure.flushRustRecording();
    assert(flushSuccess, "Rust recording flush should succeed");

    // Use an extremely high cost of growth that exceeds all potential error reductions
    const extremelyHighCost = 1000.0;

    const selected = await discoverStructure.selectNeuronsWeightedByError(
      10,
      extremelyHighCost,
    );

    // Should return empty array when all neurons are below threshold
    assert(
      selected.length === 0,
      `Should return empty array when all neurons below threshold, got ${selected.length}`,
    );

    await discoverStructure.cleanUp();
  },
});
