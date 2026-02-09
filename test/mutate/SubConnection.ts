import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { SubConnection } from "../../src/mutate/SubConnection.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SubConnection - should remove a forward connection", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
      { from: 0, to: 3, weight: 0.7 }, // Direct path to output
      { from: 1, to: 3, weight: 0.6 }, // Another direct path
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const synapsesBeforeCount = creature.synapses.length;
  const mutator = new SubConnection(creature);
  const changed = mutator.mutate();

  assert(changed, "Should successfully remove a connection");
  assert(
    creature.synapses.length <= synapsesBeforeCount,
    "Should have same or fewer synapses",
  );
  creatureValidate(creature);
});

Deno.test("SubConnection - should handle creature with minimal connections", () => {
  // Creature with only essential connections
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const mutator = new SubConnection(creature);
  mutator.mutate();

  // May or may not change depending on removal logic
  creatureValidate(creature);
});

Deno.test("SubConnection - should handle orphan cleanup after removal", () => {
  // Create creature where removing a connection may orphan a neuron
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
      { from: 1, to: 3, weight: 0.9 }, // Direct path to output
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Run multiple attempts to hit the orphan cleanup path
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const mutator = new SubConnection(testCreature);
    mutator.mutate();
    creatureValidate(testCreature);
  }
});

Deno.test("SubConnection - stress test produces valid creatures", () => {
  for (let iteration = 0; iteration < 50; iteration++) {
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
        { from: 0, to: 5, weight: 0.5 },
      ],
      input: 3,
      output: 1,
    });

    creatureValidate(creature);

    const mutator = new SubConnection(creature);
    mutator.mutate();

    creatureValidate(creature);
  }
});

Deno.test("SubConnection - focus list limits removable connections", () => {
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
      { from: 0, to: 4, weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const mutator = new SubConnection(creature);
  mutator.mutate([2]); // Focus on neuron at index 2

  creatureValidate(creature);
});
