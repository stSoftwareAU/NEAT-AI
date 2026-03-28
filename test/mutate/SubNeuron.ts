import { assert, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { SubNeuron } from "../../src/mutate/SubNeuron.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SubNeuron - should remove a hidden neuron", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
      { from: 1, to: 3, weight: 0.9 }, // Direct path to keep output valid
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const neuronsBeforeCount = creature.neurons.length;
  const mutator = new SubNeuron(creature);
  const changed = mutator.mutate();

  assert(changed, "Should successfully remove a hidden neuron");
  assert(
    creature.neurons.length < neuronsBeforeCount,
    "Should have fewer neurons",
  );
  creatureValidate(creature);
});

Deno.test("SubNeuron - should return false when no removable neurons exist", () => {
  // Only output neurons remain - no hidden or constant to remove
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 2 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const mutator = new SubNeuron(creature);
  const changed = mutator.mutate();

  assertFalse(changed, "Should return false when no removable neurons exist");
  creatureValidate(creature);
});

Deno.test("SubNeuron - should handle cascade removal of orphaned neurons", () => {
  // Create a chain: input->hidden1->hidden2->output, plus direct input->output.
  // Removing hidden1 orphans hidden2 (no inward connections), so both should go.
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.3, index: 3 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.7 },
      { from: 3, to: 4, weight: 0.9 },
      { from: 0, to: 4, weight: 0.5 }, // Direct path for output validity
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  let cascadeOccurred = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const hiddenCountBefore = testCreature.neurons.filter((n) =>
      n.type === "hidden"
    ).length;

    const mutator = new SubNeuron(testCreature);
    const changed = mutator.mutate();

    creatureValidate(testCreature);

    if (changed) {
      const hiddenCountAfter =
        testCreature.neurons.filter((n) => n.type === "hidden").length;
      // If more than one hidden neuron was removed, cascade cleanup occurred
      if (hiddenCountBefore - hiddenCountAfter > 1) {
        cascadeOccurred = true;
        break;
      }
    }
  }

  assert(
    cascadeOccurred,
    "Should cascade-remove orphaned neurons when removing their only source",
  );
});

Deno.test("SubNeuron - stress test produces valid creatures", () => {
  for (let iteration = 0; iteration < 50; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 3 },
        { type: "hidden", squash: "TANH", bias: 0.3, index: 4 },
        { type: "hidden", squash: "LOGISTIC", bias: 0.2, index: 5 },
        { type: "output", squash: "LOGISTIC", bias: 0.1, index: 6 },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 4, weight: 0.8 },
        { from: 2, to: 5, weight: 0.6 },
        { from: 3, to: 6, weight: 0.9 },
        { from: 4, to: 6, weight: 0.7 },
        { from: 5, to: 6, weight: 0.5 },
        { from: 0, to: 6, weight: 0.4 },
      ],
      input: 3,
      output: 1,
    });

    creatureValidate(creature);

    const mutator = new SubNeuron(creature);
    mutator.mutate();

    creatureValidate(creature);
  }
});

Deno.test("SubNeuron - focus list limits removable neurons", () => {
  let mutationSucceeded = false;

  for (let attempt = 0; attempt < 50; attempt++) {
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

    // Focus only on neuron at index 2 — neuron at index 3 should not be removed
    const mutator = new SubNeuron(creature);
    const changed = mutator.mutate([2]);

    creatureValidate(creature);

    if (changed) {
      // Verify the non-focused neuron (index 3) was preserved
      const hasNeuron3 = creature.neurons.some((n) =>
        n.type === "hidden" && n.bias === 0.3
      );
      assert(
        hasNeuron3,
        "Non-focused hidden neuron should be preserved when focus list excludes it",
      );
      mutationSucceeded = true;
      break;
    }
  }

  assert(
    mutationSucceeded,
    "SubNeuron with focus list should succeed within 50 attempts",
  );
});

Deno.test("SubNeuron - can remove constant neurons", () => {
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

  const mutator = new SubNeuron(creature);
  const changed = mutator.mutate();

  assert(changed, "Should be able to remove a constant neuron");
  creatureValidate(creature);
});
