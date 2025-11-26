/**
 * Integration tests for neuron discovery functionality.
 *
 * These tests use the REAL Rust library to diagnose potential issues
 * with neuron discovery in production scenarios.
 *
 * Key areas tested:
 * 1. Simple creature - baseline that should always work
 * 2. Complex multi-layer creatures - production-like scenarios
 * 3. Wide creatures - many inputs/neurons
 * 4. Diagnostic output for debugging
 *
 * Created: 26-Nov-2025
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  isRustDiscoveryEnabled,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";

// =============================================================================
// Test Scenarios - Designed to reveal production issues
// =============================================================================

/**
 * Creates a scenario where a simple hidden neuron is missing.
 * This is the simplest case - if this fails, something is fundamentally broken.
 */
function makeSimpleRecoveryScenario(): {
  targetCreature: Creature;
  crippledCreature: Creature;
  trainingData: DataRecordInterface[];
} {
  // Target: input -> TANH hidden -> output
  const targetJson: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-tanh", squash: TANH.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-tanh", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "hidden-tanh", weight: -0.5 },
      { fromUUID: "hidden-tanh", toUUID: "output-0", weight: 0.7 },
      // Some direct connections too
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.1 },
    ],
  };
  const targetCreature = Creature.fromJSON(targetJson);
  targetCreature.validate();

  // Crippled: missing the hidden neuron entirely
  const crippledJson: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      // Direct connections only - can't capture TANH non-linearity
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.2 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.1 },
    ],
  };
  const crippledCreature = Creature.fromJSON(crippledJson);
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  // Generate training data from target
  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 256; i++) {
    const input = new Float32Array(3);
    for (let j = 0; j < 3; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    const output = targetCreature.activate(input);
    trainingData.push({ input, output: new Float32Array(output) });
  }

  return { targetCreature, crippledCreature, trainingData };
}

/**
 * Creates a multi-layer scenario similar to production.
 * The crippled creature is missing a critical hidden neuron in layer 2.
 */
function makeMultiLayerScenario(): {
  targetCreature: Creature;
  crippledCreature: Creature;
  trainingData: DataRecordInterface[];
} {
  const targetJson: CreatureExport = {
    input: 10,
    output: 2,
    neurons: [
      // Layer 1
      { type: "hidden", uuid: "L1-a", squash: TANH.NAME, bias: 0.1 },
      { type: "hidden", uuid: "L1-b", squash: LeakyReLU.NAME, bias: -0.1 },
      // Layer 2 - one neuron will be "missing"
      { type: "hidden", uuid: "L2-missing", squash: TANH.NAME, bias: 0.2 },
      { type: "hidden", uuid: "L2-present", squash: Mish.NAME, bias: 0 },
      // Outputs
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-1", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      // Input to L1
      { fromUUID: "input-0", toUUID: "L1-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "L1-a", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "L1-b", weight: 0.4 },
      { fromUUID: "input-3", toUUID: "L1-b", weight: 0.2 },
      // L1 to L2
      { fromUUID: "L1-a", toUUID: "L2-missing", weight: 0.7 },
      { fromUUID: "L1-b", toUUID: "L2-missing", weight: -0.4 },
      { fromUUID: "L1-a", toUUID: "L2-present", weight: 0.3 },
      { fromUUID: "L1-b", toUUID: "L2-present", weight: 0.5 },
      // L2 to outputs
      { fromUUID: "L2-missing", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "L2-missing", toUUID: "output-1", weight: -0.6 },
      { fromUUID: "L2-present", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "L2-present", toUUID: "output-1", weight: 0.4 },
    ],
  };
  const targetCreature = Creature.fromJSON(targetJson);
  targetCreature.validate();

  // Crippled: L2-missing is removed
  const crippledJson: CreatureExport = {
    input: 10,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "L1-a", squash: TANH.NAME, bias: 0.1 },
      { type: "hidden", uuid: "L1-b", squash: LeakyReLU.NAME, bias: -0.1 },
      // L2-missing is GONE
      { type: "hidden", uuid: "L2-present", squash: Mish.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-1", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "L1-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "L1-a", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "L1-b", weight: 0.4 },
      { fromUUID: "input-3", toUUID: "L1-b", weight: 0.2 },
      // L1 to L2-present only
      { fromUUID: "L1-a", toUUID: "L2-present", weight: 0.3 },
      { fromUUID: "L1-b", toUUID: "L2-present", weight: 0.5 },
      // L2-present to outputs only
      { fromUUID: "L2-present", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "L2-present", toUUID: "output-1", weight: 0.4 },
      // Add some direct connections to compensate (won't be perfect)
      { fromUUID: "L1-a", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "L1-b", toUUID: "output-1", weight: -0.2 },
    ],
  };
  const crippledCreature = Creature.fromJSON(crippledJson);
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 512; i++) {
    const input = new Float32Array(10);
    for (let j = 0; j < 10; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    const output = targetCreature.activate(input);
    trainingData.push({ input, output: new Float32Array(output) });
  }

  return { targetCreature, crippledCreature, trainingData };
}

/**
 * Creates a wide creature similar to production (many inputs, many hidden neurons).
 */
function makeWideCreatureScenario(): {
  targetCreature: Creature;
  crippledCreature: Creature;
  trainingData: DataRecordInterface[];
} {
  const targetNeurons: CreatureExport["neurons"] = [];
  const targetSynapses: CreatureExport["synapses"] = [];
  const crippledNeurons: CreatureExport["neurons"] = [];
  const crippledSynapses: CreatureExport["synapses"] = [];

  // Create 10 hidden neurons, one will be "critical"
  for (let i = 0; i < 10; i++) {
    const neuron = {
      type: "hidden" as const,
      uuid: `hidden-${i}`,
      squash: i % 3 === 0
        ? TANH.NAME
        : (i % 3 === 1 ? LeakyReLU.NAME : Mish.NAME),
      bias: (i - 5) * 0.1,
    };
    targetNeurons.push(neuron);
    // Skip hidden-5 in crippled (the "missing" neuron)
    if (i !== 5) {
      crippledNeurons.push({ ...neuron });
    }
  }

  // Add outputs
  for (let i = 0; i < 3; i++) {
    const neuron = {
      type: "output" as const,
      uuid: `output-${i}`,
      squash: IDENTITY.NAME,
      bias: 0,
    };
    targetNeurons.push(neuron);
    crippledNeurons.push({ ...neuron });
  }

  // Connect inputs to hidden (sparse)
  for (let h = 0; h < 10; h++) {
    const inputStart = h * 2;
    for (let j = 0; j < 3; j++) {
      const synapse = {
        fromUUID: `input-${(inputStart + j) % 30}`,
        toUUID: `hidden-${h}`,
        weight: (Math.random() - 0.5) * 2,
      };
      targetSynapses.push(synapse);
      if (h !== 5) {
        crippledSynapses.push({ ...synapse });
      }
    }
  }

  // Connect hidden to outputs
  for (let h = 0; h < 10; h++) {
    for (let o = 0; o < 3; o++) {
      if ((h + o) % 2 === 0) {
        const synapse = {
          fromUUID: `hidden-${h}`,
          toUUID: `output-${o}`,
          weight: (Math.random() - 0.5) * 2,
        };
        targetSynapses.push(synapse);
        if (h !== 5) {
          crippledSynapses.push({ ...synapse });
        }
      }
    }
  }

  const targetCreature = Creature.fromJSON({
    input: 30,
    output: 3,
    neurons: targetNeurons,
    synapses: targetSynapses,
  });
  targetCreature.validate();

  const crippledCreature = Creature.fromJSON({
    input: 30,
    output: 3,
    neurons: crippledNeurons,
    synapses: crippledSynapses,
  });
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 512; i++) {
    const input = new Float32Array(30);
    for (let j = 0; j < 30; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    const output = targetCreature.activate(input);
    trainingData.push({ input, output: new Float32Array(output) });
  }

  return { targetCreature, crippledCreature, trainingData };
}

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test({
  name: "Neuron discovery: simple creature baseline",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { crippledCreature, trainingData } = makeSimpleRecoveryScenario();

    console.log("\n=== SIMPLE CREATURE TEST ===");
    console.log(`Creature: ${crippledCreature.neurons.length} neurons`);
    console.log(`Training: ${trainingData.length} samples`);

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<string, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      const recorded = discoverStructure.record(trainingData, neuronPromises);
      assert(recorded, "Recording should succeed");
      await Promise.all([...neuronPromises.values()]);

      const flushSuccess = discoverStructure.flushRustRecording();
      assert(flushSuccess, "Flush should succeed");

      const candidates = await discoverStructure.analyzeMissingNeurons([
        "output-0",
      ]);

      console.log(`Candidates found: ${candidates?.length ?? 0}`);
      if (candidates && candidates.length > 0) {
        candidates.forEach((c) => {
          console.log(
            `  ${c.squash}: ${c.fromNeuronUUID} -> ${c.toNeuronUUID}`,
          );
          console.log(
            `    improvement: ${
              (c.expectedImprovementPercentage * 100).toFixed(2)
            }%`,
          );
        });

        // Try to add the neuron
        const improved = DiscoverStructure.addHelpfulNeurons(
          "test",
          crippledCreature,
          candidates.slice(0, 1),
        );
        if (improved) {
          improved.validate();
          console.log("✓ Successfully added discovery neuron");
        }
      } else {
        console.log("⚠ No neuron candidates found - THIS IS A PROBLEM");
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name: "Neuron discovery: multi-layer creature",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { crippledCreature, trainingData } = makeMultiLayerScenario();

    console.log("\n=== MULTI-LAYER CREATURE TEST ===");
    console.log(`Creature: ${crippledCreature.neurons.length} neurons`);
    console.log(`Training: ${trainingData.length} samples`);

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      120,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<string, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      discoverStructure.record(trainingData, neuronPromises);
      await Promise.all([...neuronPromises.values()]);
      discoverStructure.flushRustRecording();

      // Test each output separately
      for (const outputUUID of ["output-0", "output-1"]) {
        // deno-lint-ignore no-await-in-loop
        const candidates = await discoverStructure.analyzeMissingNeurons([
          outputUUID,
        ]);
        console.log(`${outputUUID}: ${candidates?.length ?? 0} candidates`);
        if (candidates && candidates.length > 0) {
          const best = candidates[0];
          console.log(
            `  Best: ${best.squash} ${best.fromNeuronUUID}->${best.toNeuronUUID} (${
              (best.expectedImprovementPercentage * 100).toFixed(2)
            }%)`,
          );
        }
      }

      // Test combined
      const allCandidates = await discoverStructure.analyzeMissingNeurons([
        "output-0",
        "output-1",
      ]);
      console.log(`Combined: ${allCandidates?.length ?? 0} candidates`);

      if (allCandidates && allCandidates.length > 0) {
        const improved = DiscoverStructure.addHelpfulNeurons(
          "test",
          crippledCreature,
          allCandidates,
        );
        if (improved) {
          improved.validate();
          console.log(
            `✓ Added ${
              improved.neurons.length - crippledCreature.neurons.length
            } neuron(s)`,
          );
        }
      } else {
        console.log("⚠ No candidates found for multi-layer creature");
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name: "Neuron discovery: wide creature (production-like)",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { crippledCreature, trainingData } = makeWideCreatureScenario();

    console.log("\n=== WIDE CREATURE TEST ===");
    console.log(`Creature: ${crippledCreature.neurons.length} neurons`);
    console.log(`Training: ${trainingData.length} samples`);

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      180,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<string, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      discoverStructure.record(trainingData, neuronPromises);
      await Promise.all([...neuronPromises.values()]);
      discoverStructure.flushRustRecording();

      const focusNeurons = ["output-0", "output-1", "output-2"];
      const candidates = await discoverStructure.analyzeMissingNeurons(
        focusNeurons,
      );

      console.log(`Candidates: ${candidates?.length ?? 0}`);
      if (candidates && candidates.length > 0) {
        candidates.slice(0, 5).forEach((c) => {
          console.log(
            `  ${c.squash}: ${c.fromNeuronUUID} -> ${c.toNeuronUUID} (${
              (c.expectedImprovementPercentage * 100).toFixed(2)
            }%)`,
          );
        });
      } else {
        console.log("⚠ No candidates found for wide creature - investigate!");
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name: "Neuron discovery: collectRustAnalysisCandidates (production method)",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { crippledCreature, trainingData } = makeMultiLayerScenario();

    console.log("\n=== PRODUCTION METHOD TEST ===");

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      120,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<string, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);
      discoverStructure.record(trainingData, neuronPromises);
      await Promise.all([...neuronPromises.values()]);
      discoverStructure.flushRustRecording();

      // This is what DiscoverDirectory uses in production
      const bundle = discoverStructure.collectRustAnalysisCandidates(
        ["output-0", "output-1"],
      );

      if (bundle) {
        console.log(
          `helpfulSynapses: ${bundle.helpfulSynapses?.length ?? 0}`,
        );
        console.log(`harmfulSynapse: ${bundle.harmfulSynapse ? "yes" : "no"}`);
        console.log(`helpfulNeurons: ${bundle.helpfulNeurons?.length ?? 0}`);

        if (bundle.helpfulNeurons && bundle.helpfulNeurons.length > 0) {
          console.log("✓ Neuron discovery returned candidates");
          bundle.helpfulNeurons.slice(0, 3).forEach((n) => {
            console.log(
              `  ${n.squash}: ${n.fromNeuronUUID} -> ${n.toNeuronUUID} (${
                (n.expectedImprovementPercentage * 100).toFixed(2)
              }%)`,
            );
          });
        } else {
          console.log("⚠ No neuron candidates from production method!");
        }
      } else {
        console.log("⚠ Bundle is undefined - Rust analysis failed");
      }
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

/**
 * Diagnostic test - prints detailed info about what's happening
 */
Deno.test({
  name: "Neuron discovery: DIAGNOSTIC - detailed analysis",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { targetCreature, crippledCreature, trainingData } =
      makeMultiLayerScenario();

    console.log("\n========================================");
    console.log("NEURON DISCOVERY DIAGNOSTIC");
    console.log("========================================\n");

    console.log("Environment:");
    console.log(`  Rust discovery enabled: ${isRustDiscoveryEnabled()}`);
    console.log(`  DEFAULT_RUST_FLUSH_RECORDS: ${DEFAULT_RUST_FLUSH_RECORDS}`);

    console.log("\nTarget creature:");
    console.log(`  Neurons: ${targetCreature.neurons.length}`);
    targetCreature.neurons.forEach((n) => {
      console.log(`    ${n.uuid}: ${n.squash}`);
    });

    console.log("\nCrippled creature:");
    console.log(`  Neurons: ${crippledCreature.neurons.length}`);
    crippledCreature.neurons.forEach((n) => {
      console.log(`    ${n.uuid}: ${n.squash}`);
    });

    console.log(`\nTraining data: ${trainingData.length} samples`);

    // Calculate error before discovery
    let totalError = 0;
    for (const sample of trainingData) {
      const actual = crippledCreature.activate(sample.input);
      for (let i = 0; i < sample.output.length; i++) {
        totalError += Math.abs(actual[i] - sample.output[i]);
      }
    }
    const avgError = totalError / (trainingData.length * 2);
    console.log(`Average absolute error: ${avgError.toFixed(4)}`);

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      180,
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<string, Promise<void>>();

    try {
      console.log("\n--- Initialisation ---");
      discoverStructure.initialize(neuronPromises);

      console.log("\n--- Recording ---");
      const recorded = discoverStructure.record(trainingData, neuronPromises);
      console.log(`Record returned: ${recorded}`);
      await Promise.all([...neuronPromises.values()]);

      console.log("\n--- Flush ---");
      const flushSuccess = discoverStructure.flushRustRecording();
      console.log(`Flush returned: ${flushSuccess}`);

      console.log("\n--- Analysis (per output) ---");
      for (const outputUUID of ["output-0", "output-1"]) {
        console.log(`\nFocus: ${outputUUID}`);
        // deno-lint-ignore no-await-in-loop
        const candidates = await discoverStructure.analyzeMissingNeurons([
          outputUUID,
        ]);
        if (candidates && candidates.length > 0) {
          console.log(`  Found ${candidates.length} candidate(s)`);
          candidates.forEach((c) => {
            console.log(`    ${c.squash} from ${c.fromNeuronUUID}`);
            console.log(`      to: ${c.toNeuronUUID}`);
            console.log(`      inWeight: ${c.incomingWeight.toFixed(4)}`);
            console.log(`      outWeight: ${c.outgoingWeight.toFixed(4)}`);
            console.log(`      bias: ${c.bias.toFixed(4)}`);
            console.log(
              `      improvement: ${
                (c.expectedImprovementPercentage * 100).toFixed(4)
              }%`,
            );
            console.log(`      improved: ${c.improvedCount}/${c.totalCount}`);
          });
        } else {
          console.log("  No candidates found");
        }
      }

      console.log("\n--- Combined analysis ---");
      const allCandidates = await discoverStructure.analyzeMissingNeurons([
        "output-0",
        "output-1",
      ]);
      console.log(`Total candidates: ${allCandidates?.length ?? 0}`);

      if (allCandidates && allCandidates.length > 0) {
        console.log("\n--- Add neuron test ---");
        const improved = DiscoverStructure.addHelpfulNeurons(
          "diagnostic",
          crippledCreature,
          allCandidates.slice(0, 1),
        );
        if (improved) {
          improved.validate();
          console.log(`Added neuron successfully`);
          console.log(
            `  Neurons: ${crippledCreature.neurons.length} -> ${improved.neurons.length}`,
          );

          // Check if error improved
          let newTotalError = 0;
          for (const sample of trainingData) {
            const actual = improved.activate(sample.input);
            for (let i = 0; i < sample.output.length; i++) {
              newTotalError += Math.abs(actual[i] - sample.output[i]);
            }
          }
          const newAvgError = newTotalError / (trainingData.length * 2);
          console.log(
            `  Error: ${avgError.toFixed(4)} -> ${newAvgError.toFixed(4)}`,
          );
          console.log(
            `  Change: ${
              ((newAvgError - avgError) / avgError * 100).toFixed(2)
            }%`,
          );
        } else {
          console.log("Failed to add neuron");
        }
      }

      console.log("\n========================================\n");
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

/**
 * Test addHelpfulNeurons with valid input
 */
Deno.test({
  name: "addHelpfulNeurons: creates valid creature structure",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    const creature = Creature.fromJSON({
      input: 3,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      ],
    });
    creature.validate();
    CreatureUtil.makeUUID(creature);

    const candidates = [{
      fromNeuronUUID: "input-0",
      toNeuronUUID: "output-0",
      squash: TANH.NAME,
      bias: 0.1,
      incomingWeight: 0.5,
      outgoingWeight: 0.3,
      expectedImprovementPercentage: 0.01, // 1% - realistic small improvement
      improvedCount: 51,
      totalCount: 100,
    }];

    const improved = DiscoverStructure.addHelpfulNeurons(
      "test",
      creature,
      candidates,
    );

    assertExists(improved, "Should create improved creature");
    improved.validate();

    assertEquals(
      improved.neurons.length,
      creature.neurons.length + 1,
      "Should add one neuron",
    );

    const discoveryNeuron = improved.neurons.find((n) =>
      n.uuid?.startsWith("hidden-discovery-")
    );
    assertExists(discoveryNeuron, "Should have discovery neuron");
    assertEquals(discoveryNeuron.squash, TANH.NAME);

    console.log("✓ addHelpfulNeurons creates valid structure");
  },
});
