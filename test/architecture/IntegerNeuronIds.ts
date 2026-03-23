/**
 * IntegerNeuronIds.ts - Tests for integer-based neuron identity system.
 *
 * Issue #1958: Verifies that neurons use integer IDs instead of UUID strings,
 * and that all serialisation, breeding, and mutation operations work correctly
 * with the new integer ID scheme.
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  inputNeuronId,
  isOutputNeuronId,
  nextNeuronId,
  outputIndexFromId,
  outputNeuronId,
} from "../../src/architecture/NeuronId.ts";

Deno.test("Input neurons have integer IDs matching their index", () => {
  const creature = new Creature(3, 2);
  for (let i = 0; i < creature.input; i++) {
    const neuron = creature.neurons[i];
    assertEquals(typeof neuron.id, "number", "Input neuron ID should be a number");
    assertEquals(neuron.id, i, `Input neuron ${i} should have id=${i}`);
  }
});

Deno.test("Output neurons have negative integer IDs", () => {
  const creature = new Creature(3, 2);
  const outputStart = creature.neurons.length - creature.output;
  for (let i = 0; i < creature.output; i++) {
    const neuron = creature.neurons[outputStart + i];
    assertEquals(typeof neuron.id, "number", "Output neuron ID should be a number");
    assertEquals(
      neuron.id,
      outputNeuronId(i),
      `Output neuron ${i} should have id=${outputNeuronId(i)}`,
    );
    assertEquals(
      isOutputNeuronId(neuron.id),
      true,
      "Output neuron ID should be recognised as output",
    );
    assertEquals(
      outputIndexFromId(neuron.id),
      i,
      "Output index should be recoverable from ID",
    );
  }
});

Deno.test("Hidden neurons have positive integer IDs >= 1_000_000", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") {
      assertEquals(typeof neuron.id, "number", "Hidden neuron ID should be a number");
      assertEquals(
        neuron.id >= 1_000_000,
        true,
        `Hidden neuron ID ${neuron.id} should be >= 1_000_000`,
      );
    }
  }
});

Deno.test("nextNeuronId returns unique sequential integers", () => {
  const id1 = nextNeuronId();
  const id2 = nextNeuronId();
  assertNotEquals(id1, id2, "Sequential IDs should be unique");
  assertEquals(id2, id1 + 1, "Sequential IDs should be consecutive");
});

Deno.test("NeuronId utility functions are consistent", () => {
  assertEquals(inputNeuronId(0), 0);
  assertEquals(inputNeuronId(5), 5);
  assertEquals(outputNeuronId(0), -1);
  assertEquals(outputNeuronId(1), -2);
  assertEquals(outputNeuronId(2), -3);
  assertEquals(isOutputNeuronId(-1), true);
  assertEquals(isOutputNeuronId(-3), true);
  assertEquals(isOutputNeuronId(0), false);
  assertEquals(isOutputNeuronId(5), false);
  assertEquals(outputIndexFromId(-1), 0);
  assertEquals(outputIndexFromId(-2), 1);
  assertEquals(outputIndexFromId(-3), 2);
});

Deno.test("Serialisation round-trip preserves integer neuron IDs", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const exported = creature.exportJSON();

  // Verify export uses integer IDs
  for (const neuron of exported.neurons) {
    assertEquals(typeof neuron.id, "number", "Exported neuron should have numeric id");
  }
  for (const synapse of exported.synapses) {
    assertEquals(typeof synapse.fromId, "number", "Synapse fromId should be numeric");
    assertEquals(typeof synapse.toId, "number", "Synapse toId should be numeric");
  }

  // Round-trip: load back and verify
  const restored = Creature.fromJSON(exported);
  assertEquals(restored.neurons.length, creature.neurons.length);

  for (let i = 0; i < creature.neurons.length; i++) {
    assertEquals(
      restored.neurons[i].id,
      creature.neurons[i].id,
      `Neuron ${i} ID should survive round-trip`,
    );
  }
});

Deno.test("Breeding offspring uses integer neuron IDs", async () => {
  const { Offspring } = await import("../../src/architecture/Offspring.ts");

  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });

  const child = Offspring.breed(mum, dad);
  if (child) {
    for (const neuron of child.neurons) {
      assertEquals(
        typeof neuron.id, "number",
        `Offspring neuron should have numeric id, got ${typeof neuron.id}`,
      );
    }
  }
});

Deno.test("Genetic compatibility works with integer IDs", async () => {
  const { geneticCompatibility } = await import(
    "../../src/breed/GeneticCompatibility.ts"
  );

  const a = new Creature(2, 1, {
    layers: [{ count: 3, squash: "TANH" }],
  });
  const b = a.shallowClone();

  // Same structure should be fully compatible
  const compatibility = geneticCompatibility(a, b);
  assertEquals(compatibility, 1, "Identical creatures should have compatibility 1");
});
