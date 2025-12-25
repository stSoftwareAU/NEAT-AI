import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { cleanupOrphanedNeurons } from "../../src/compact/CompactUtils.ts";
import { LOGISTIC } from "../../src/methods/activations/types/LOGISTIC.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("cleanupOrphanedNeurons - should remove hidden neuron with no outward connections", () => {
  // Create a creature export with a hidden neuron that has no outward connections
  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.5,
        uuid: "orphan-hidden-1",
      },
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.3,
        uuid: "valid-hidden-2",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Input to orphan hidden (has inward but no outward)
      {
        fromUUID: "input-0",
        toUUID: "orphan-hidden-1",
        weight: 1.0,
      },
      // Input to valid hidden
      {
        fromUUID: "input-0",
        toUUID: "valid-hidden-2",
        weight: 1.0,
      },
      // Valid hidden to output
      {
        fromUUID: "valid-hidden-2",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Before cleanup, trying to create a creature should fail validation
  // because orphan-hidden-1 has no outward connections
  assertThrows(
    () => {
      const creature = Creature.fromJSON(creatureExport);
      creatureValidate(creature);
    },
    Error,
    "no outward connections",
  );

  // Run cleanup
  cleanupOrphanedNeurons(creatureExport);

  // After cleanup, the creature should be valid
  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);

  // The orphaned neuron should have been removed
  assertEquals(creatureExport.neurons.length, 2);
  assertEquals(
    creatureExport.neurons.find((n) => n.uuid === "orphan-hidden-1"),
    undefined,
    "Orphaned neuron should be removed",
  );

  // The synapse to the orphaned neuron should also be removed
  assertEquals(creatureExport.synapses.length, 2);
  assertEquals(
    creatureExport.synapses.find((s) => s.toUUID === "orphan-hidden-1"),
    undefined,
    "Synapse to orphaned neuron should be removed",
  );
});

Deno.test("cleanupOrphanedNeurons - should handle cascade removal of orphaned neurons", () => {
  // Create a creature export where removing one neuron creates another orphan
  // A -> B -> C -> output
  // If we remove C, then B becomes orphaned, then A becomes orphaned
  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.5,
        uuid: "hidden-A",
      },
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.3,
        uuid: "hidden-B",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Input to hidden A
      {
        fromUUID: "input-0",
        toUUID: "hidden-A",
        weight: 1.0,
      },
      // A -> B (only outward connection from A)
      {
        fromUUID: "hidden-A",
        toUUID: "hidden-B",
        weight: 1.0,
      },
      // Input directly to output (to keep output valid)
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Hidden-B has no outward connections - this is the initial orphan
  // When B is removed, hidden-A will also become an orphan

  // Run cleanup - should remove both A and B
  cleanupOrphanedNeurons(creatureExport);

  // After cleanup, only output neuron should remain
  assertEquals(creatureExport.neurons.length, 1);
  assertEquals(creatureExport.neurons[0].uuid, "output-0");

  // Only the direct input -> output synapse should remain
  assertEquals(creatureExport.synapses.length, 1);
  assertEquals(creatureExport.synapses[0].toUUID, "output-0");

  // Create creature to verify it's valid
  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);
});

Deno.test("cleanupOrphanedNeurons - should remove constant neurons with no outward connections", () => {
  // Constant neurons with no outward connections should also be removed
  // (they serve no purpose if not connected to anything)
  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "constant",
        bias: 1.0,
        uuid: "orphan-constant",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Input directly to output
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Run cleanup
  cleanupOrphanedNeurons(creatureExport);

  // The orphaned constant should have been removed
  assertEquals(creatureExport.neurons.length, 1);
  assertEquals(creatureExport.neurons[0].uuid, "output-0");
});

Deno.test("cleanupOrphanedNeurons - should not remove output neurons even if no outward connections", () => {
  // Output neurons never have outward connections by design, so they should not be removed
  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Input directly to output
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  const neuronCountBefore = creatureExport.neurons.length;

  // Run cleanup
  cleanupOrphanedNeurons(creatureExport);

  // Output neuron should still be there
  assertEquals(creatureExport.neurons.length, neuronCountBefore);
  assertEquals(creatureExport.neurons[0].uuid, "output-0");
});

Deno.test("cleanupOrphanedNeurons - simulates remove-low-impact scenario from issue", () => {
  // This test simulates the exact scenario from the issue:
  // A low-impact neuron is removed, but its removal leaves another hidden neuron
  // with no outward connections (previously only connected to the removed neuron)

  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.5,
        uuid: "feeder-hidden",
      },
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.3,
        uuid: "low-impact-target",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Input to feeder hidden
      {
        fromUUID: "input-0",
        toUUID: "feeder-hidden",
        weight: 1.0,
      },
      // Feeder hidden -> low-impact target (feeder's ONLY outward connection)
      {
        fromUUID: "feeder-hidden",
        toUUID: "low-impact-target",
        weight: 0.001, // Low weight = low impact
      },
      // Low-impact target to output
      {
        fromUUID: "low-impact-target",
        toUUID: "output-0",
        weight: 0.001, // Low weight = low impact
      },
      // Direct connection to output (keeps output valid)
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Verify initial creature is valid
  const initialCreature = Creature.fromJSON(creatureExport);
  creatureValidate(initialCreature);

  // Simulate remove-low-impact: remove the low-impact-target neuron
  creatureExport.neurons = creatureExport.neurons.filter(
    (n) => n.uuid !== "low-impact-target",
  );
  creatureExport.synapses = creatureExport.synapses.filter(
    (s) =>
      s.toUUID !== "low-impact-target" && s.fromUUID !== "low-impact-target",
  );

  // Without cleanup, this would be invalid because feeder-hidden
  // now has no outward connections
  assertThrows(
    () => {
      const creature = Creature.fromJSON(creatureExport);
      creatureValidate(creature);
    },
    Error,
    "no outward connections",
  );

  // Run cleanup to fix the orphaned neurons
  cleanupOrphanedNeurons(creatureExport);

  // Now the creature should be valid
  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);

  // Only output neuron should remain (feeder-hidden should be cleaned up too)
  assertEquals(creatureExport.neurons.length, 1);
  assertEquals(creatureExport.neurons[0].uuid, "output-0");
});

Deno.test("cleanupOrphanedNeurons - returns correct count of removed neurons", () => {
  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.5,
        uuid: "orphan-1",
      },
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: 0.3,
        uuid: "orphan-2",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Input to orphan 1 (no outward)
      {
        fromUUID: "input-0",
        toUUID: "orphan-1",
        weight: 1.0,
      },
      // Orphan 1 -> orphan 2 (orphan 2 has no outward)
      {
        fromUUID: "orphan-1",
        toUUID: "orphan-2",
        weight: 1.0,
      },
      // Direct connection to output
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Run cleanup and check return value
  const result = cleanupOrphanedNeurons(creatureExport);

  // Should have removed 2 neurons (orphan-2 first, then orphan-1)
  assertEquals(result.removed, 2);
  assertEquals(result.converted, 0);
  assertEquals(creatureExport.neurons.length, 1);
});

Deno.test("cleanupOrphanedNeurons - should apply squash function when converting hidden to constant", () => {
  // A hidden neuron with bias X and squash function (e.g., LOGISTIC) would output
  // squash(0 + X) when receiving no input. When converted to a constant, the bias
  // must be transformed through the squash function.
  //
  // This test verifies the fix for the bug where cleanupOrphanedNeurons was copying
  // the raw bias value directly instead of applying the activation function.

  const rawBias = 0.5;
  const logistic = new LOGISTIC();
  const expectedSquashedBias = logistic.squash(rawBias); // Should be ~0.6224593312

  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: LOGISTIC.NAME,
        bias: rawBias,
        uuid: "hidden-no-inward",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Hidden -> output (hidden has outward but NO inward connections)
      {
        fromUUID: "hidden-no-inward",
        toUUID: "output-0",
        weight: 1.0,
      },
      // Input to output (to keep structure valid)
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Run cleanup - should convert hidden to constant with squashed bias
  cleanupOrphanedNeurons(creatureExport);

  // The hidden neuron should have been converted to a constant
  const convertedNeuron = creatureExport.neurons.find(
    (n) => n.uuid === "hidden-no-inward",
  );
  assertEquals(
    convertedNeuron?.type,
    "constant",
    "Hidden neuron should be converted to constant",
  );

  // The bias should be the SQUASHED value, not the raw bias
  assertAlmostEquals(
    convertedNeuron?.bias ?? 0,
    expectedSquashedBias,
    0.0001,
    `Constant bias should be squashed (expected ${expectedSquashedBias}, got ${convertedNeuron?.bias})`,
  );

  // Verify the creature is valid after cleanup
  const creature = Creature.fromJSON(creatureExport);
  creatureValidate(creature);
});

Deno.test("cleanupOrphanedNeurons - should apply TANH squash function when converting hidden to constant", () => {
  // Test with a different activation function (TANH) to ensure the fix
  // works generically for all squash functions.

  const rawBias = 1.5;
  const tanh = new TANH();
  const expectedSquashedBias = tanh.squash(rawBias); // Should be ~0.9051482536

  const creatureExport: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: TANH.NAME,
        bias: rawBias,
        uuid: "hidden-tanh",
      },
      {
        type: "output",
        squash: LOGISTIC.NAME,
        bias: 0.1,
        uuid: "output-0",
      },
    ],
    synapses: [
      // Hidden -> output (hidden has outward but NO inward connections)
      {
        fromUUID: "hidden-tanh",
        toUUID: "output-0",
        weight: 1.0,
      },
      // Input to output
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  };

  // Run cleanup and verify the result counts
  const result = cleanupOrphanedNeurons(creatureExport);
  assertEquals(result.converted, 1, "Should have converted 1 neuron");
  assertEquals(result.removed, 0, "Should have removed 0 neurons");

  // Verify the constant neuron has the TANH-squashed bias
  const convertedNeuron = creatureExport.neurons.find(
    (n) => n.uuid === "hidden-tanh",
  );
  assertEquals(convertedNeuron?.type, "constant");
  assertAlmostEquals(
    convertedNeuron?.bias ?? 0,
    expectedSquashedBias,
    0.0001,
    `Constant bias should be TANH-squashed (expected ${expectedSquashedBias}, got ${convertedNeuron?.bias})`,
  );
});
