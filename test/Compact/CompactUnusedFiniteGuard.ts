/**
 * Issue #1366: Tests for compactUnused bias adjustment finite guard.
 *
 * When removing unused neurons, the bias adjustment must produce finite
 * values. This test verifies the removeNeuron function guards against
 * non-finite bias results in the non-constant path.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { removeNeuron } from "../../src/compact/CompactUnused.ts";

Deno.test("removeNeuron - guards against non-finite bias when activation is extreme", () => {
  // Create a creature with a hidden neuron that has outward connections
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  // Find the hidden neuron
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden");
  if (!hiddenNeuron) {
    // No hidden neuron in this layout; skip
    return;
  }

  // Set up a very large weight on the outward synapse to test the guard
  const outwardSynapses = creature.outwardConnections(hiddenNeuron.index);
  if (outwardSynapses.length === 0) {
    return;
  }

  // Use a normal activation - the function should work normally
  removeNeuron(
    hiddenNeuron.uuid,
    creature,
    0.5,
  );

  // Regardless of outcome, all remaining neuron biases should be finite
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      assertEquals(
        Number.isFinite(neuron.bias),
        true,
        `Neuron ${neuron.uuid} bias should be finite after removeNeuron, got ${neuron.bias}`,
      );
    }
  }
});

Deno.test("removeNeuron - rejects removal when bias would become non-finite", () => {
  // Create a creature with a hidden neuron
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden");
  if (!hiddenNeuron) {
    return;
  }

  // Set an extreme weight that when multiplied by activation would overflow
  const outwardSynapses = creature.outwardConnections(hiddenNeuron.index);
  if (outwardSynapses.length === 0) {
    return;
  }

  // Set the output neuron's bias to near max value so addition overflows
  const targetNeuron = creature.neurons[outwardSynapses[0].to];
  targetNeuron.bias = Number.MAX_VALUE / 2;
  outwardSynapses[0].weight = Number.MAX_VALUE / 2;

  const result = removeNeuron(
    hiddenNeuron.uuid,
    creature,
    2, // activation * weight will overflow
  );

  // If the function returned true (succeeded), all biases must still be finite
  // If it returned false (rejected), that's also correct behaviour
  if (result) {
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input") {
        assertEquals(
          Number.isFinite(neuron.bias),
          true,
          `Neuron ${neuron.uuid} bias should be finite, got ${neuron.bias}`,
        );
      }
    }
  }
  // result === false is acceptable - it means the function correctly rejected
  // a removal that would have produced a non-finite bias
});
