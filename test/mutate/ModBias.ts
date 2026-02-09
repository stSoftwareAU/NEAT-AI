import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ModBias } from "../../src/mutate/ModBias.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ModBias - should modify bias of a neuron", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Record all biases before mutation
  const biasesBefore = creature.neurons.map((n) => n.bias);

  // Run mutations until we get a change (randomised neuron selection)
  let changed = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const mutator = new ModBias(testCreature);
    changed = mutator.mutate();
    if (changed) {
      // Verify at least one bias changed
      const biasesAfter = testCreature.neurons.map((n) => n.bias);
      let anyDifferent = false;
      for (let j = 0; j < biasesBefore.length; j++) {
        if (biasesBefore[j] !== biasesAfter[j]) {
          anyDifferent = true;
          break;
        }
      }
      assert(
        anyDifferent,
        "At least one bias should be different after mutation",
      );
      creatureValidate(testCreature);
      break;
    }
  }

  assert(changed, "Should eventually change a bias within 50 attempts");
});

Deno.test("ModBias - should skip constant neurons", () => {
  // Create a creature where only non-output neurons are constants
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", bias: 1.0, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 2, to: 3, weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Run many mutations; the constant neuron's bias should never change
  // but the output neuron may change
  const constantBias =
    creature.neurons.find((n) => n.type === "constant")!.bias;

  for (let i = 0; i < 100; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const mutator = new ModBias(testCreature);
    mutator.mutate();
    const constantNeuron = testCreature.neurons.find((n) =>
      n.type === "constant"
    );
    assertEquals(
      constantNeuron!.bias,
      constantBias,
      "Constant neuron bias should never change",
    );
    creatureValidate(testCreature);
  }
});

Deno.test("ModBias - stress test produces valid creatures", () => {
  for (let iteration = 0; iteration < 100; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 3 },
        { type: "hidden", squash: "TANH", bias: 0.3, index: 4 },
        { type: "output", squash: "LOGISTIC", bias: 0.1, index: 5 },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 4, weight: 0.8 },
        { from: 2, to: 3, weight: 0.6 },
        { from: 3, to: 5, weight: 0.9 },
        { from: 4, to: 5, weight: 0.7 },
      ],
      input: 3,
      output: 1,
    });

    creatureValidate(creature);

    const mutator = new ModBias(creature);
    mutator.mutate();

    creatureValidate(creature);
  }
});

Deno.test("ModBias - focus list targets specific neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.3, index: 3 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 3, weight: 1.0 },
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const mutator = new ModBias(creature);
  mutator.mutate([2]); // Focus only on neuron at index 2

  creatureValidate(creature);
});

Deno.test("ModBias - handles creature with only output neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.5, index: 2 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  let changed = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const mutator = new ModBias(testCreature);
    changed = mutator.mutate();
    if (changed) {
      creatureValidate(testCreature);
      break;
    }
  }

  // It should be possible to mutate the output neuron's bias
  assert(changed, "Should be able to modify output neuron bias");
});
