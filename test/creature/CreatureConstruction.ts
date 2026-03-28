/**
 * Tests for creature construction correctness.
 *
 * Issue #1643: Verifies that the optimised fresh construction
 * (batch synapse insertion + lightweight initialisation) produces
 * structurally valid creatures identical to the original approach.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

Deno.test("Fresh construction produces valid creature (no layers)", () => {
  const creature = new Creature(3, 2);
  creatureValidate(creature);

  assertEquals(creature.input, 3);
  assertEquals(creature.output, 2);
  assertEquals(creature.neurons.length, 5);
  // 3 inputs * 2 outputs = 6 connections
  assertEquals(creature.synapses.length, 6);
});

Deno.test("Fresh construction produces valid creature (with layers)", () => {
  const creature = new Creature(5, 3, {
    layers: [{ count: 10 }, { count: 5 }],
  });
  creatureValidate(creature);

  assertEquals(creature.input, 5);
  assertEquals(creature.output, 3);
  // 5 input + 10 hidden + 5 hidden + 3 output = 23
  assertEquals(creature.neurons.length, 23);
  // 5*10 + 10*5 + 5*3 = 50 + 50 + 15 = 115
  assertEquals(creature.synapses.length, 115);
});

Deno.test("Fresh construction synapses are sorted", () => {
  const creature = new Creature(10, 5, {
    layers: [{ count: 20 }, { count: 10 }],
  });

  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];
    if (prev.from === curr.from) {
      assertGreater(
        curr.to,
        prev.to,
        `Synapses not sorted at index ${i}: ${prev.from}->${prev.to} vs ${curr.from}->${curr.to}`,
      );
    } else {
      assertGreater(
        curr.from,
        prev.from,
        `Synapses not sorted at index ${i}: from ${prev.from} vs ${curr.from}`,
      );
    }
  }
});

Deno.test("Fresh construction with fixed squash validates", () => {
  const creature = new Creature(5, 3, {
    layers: [
      { count: 10, squash: "LOGISTIC" },
      { count: 5, squash: "LOGISTIC" },
    ],
    outputLayer: { squash: "LOGISTIC" },
  });
  creatureValidate(creature);

  // Verify all hidden/output neurons have LOGISTIC
  for (let i = creature.input; i < creature.neurons.length; i++) {
    assertEquals(creature.neurons[i].squash, "LOGISTIC");
  }
});

Deno.test("Fresh construction with random squash assigns valid squash to all neurons", () => {
  const creature = new Creature(3, 2, {
    layers: [{ count: 5 }],
  });
  creatureValidate(creature);

  for (let i = creature.input; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    assertGreater(
      neuron.squash!.length,
      0,
      `Neuron ${i} (${neuron.id}) has no squash`,
    );
  }
});

Deno.test("Fresh construction round-trips through JSON", () => {
  const creature = new Creature(5, 3, {
    layers: [{ count: 10 }, { count: 5 }],
  });
  creatureValidate(creature);

  const json = creature.exportJSON();
  const restored = Creature.fromJSON(json);
  creatureValidate(restored);

  assertEquals(restored.neurons.length, creature.neurons.length);
  assertEquals(restored.synapses.length, creature.synapses.length);
});

Deno.test("Large construction produces valid creature", () => {
  const creature = new Creature(20, 10, {
    layers: [{ count: 50 }, { count: 30 }],
  });
  creatureValidate(creature);

  assertEquals(creature.neurons.length, 110);
  // 20*50 + 50*30 + 30*10 = 1000 + 1500 + 300 = 2800
  assertEquals(creature.synapses.length, 2800);
});

Deno.test("Constructed creature can activate", () => {
  const creature = new Creature(3, 2, {
    layers: [{ count: 5, squash: "LOGISTIC" }],
    outputLayer: { squash: "LOGISTIC" },
  });
  creatureValidate(creature);

  const input = new Float32Array([0.5, 0.3, 0.8]);
  const output = creature.activate(input);

  assertEquals(output.length, 2);
  for (let i = 0; i < output.length; i++) {
    assertEquals(Number.isFinite(output[i]), true, `Output ${i} is not finite`);
  }
});
