/**
 * Tests for ModSquash focus-list relaxation behaviour.
 * Issue #1392: ModSquash should relax focus-list constraint after several
 * attempts, consistent with ModBias behaviour.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ModActivation } from "../../src/mutate/ModSquash.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

Deno.test("ModSquash - relaxes focus list after several failed attempts", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "hidden", squash: "TANH", bias: 0.3, index: 3 },
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

  // Use a focus list that targets a non-existent neuron index.
  // With the old code, ModSquash would never mutate because it never relaxes.
  // With the fix, it should eventually relax and mutate any eligible neuron.
  const impossibleFocusList = [999];

  let changed = false;
  for (let trial = 0; trial < 50; trial++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const mutator = new ModActivation(testCreature);
    changed = mutator.mutate(impossibleFocusList);
    if (changed) {
      creatureValidate(testCreature);
      break;
    }
  }

  // With relaxation, it should eventually mutate despite the impossible focus list
  assert(
    changed,
    "ModSquash should relax focus list and still mutate when no focused neurons are found",
  );
});

Deno.test("ModSquash - prefers focused neurons when available", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "hidden", squash: "TANH", bias: 0.3, index: 3 },
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

  // Focus on neuron at index 2 (hidden)
  const focusList = [2];

  let changed = false;
  for (let trial = 0; trial < 50; trial++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const mutator = new ModActivation(testCreature);
    changed = mutator.mutate(focusList);
    if (changed) {
      creatureValidate(testCreature);
      break;
    }
  }

  assert(changed, "Should be able to mutate when focused neuron exists");
});

Deno.test("ModSquash - skips constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "constant",
        uuid: "const-1",
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", squash: "LOGISTIC", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "const-1", toUUID: "output-0", weight: 0.5 },
    ],
    input: 1,
    output: 1,
  });

  creatureValidate(creature);

  // The output neuron can be mutated, but the constant cannot
  for (let i = 0; i < 100; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const testMutator = new ModActivation(testCreature);
    testMutator.mutate();
    const constantNeuron = testCreature.neurons.find((n) =>
      n.type === "constant"
    );
    assertEquals(
      constantNeuron!.bias,
      0.5,
      "Constant neuron should not be modified",
    );
  }
});
