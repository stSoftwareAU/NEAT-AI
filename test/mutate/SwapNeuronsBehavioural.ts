/**
 * Behavioural tests for the SwapNeurons mutation operator.
 *
 * Issue #1441: Verifies that:
 * 1. SwapNeurons maintains network validity
 * 2. Bias and squash are swapped between neurons
 * 3. Returns false when insufficient hidden neurons
 * 4. Creature can be exported and re-imported after swap
 * 5. Neuron UUIDs remain stable after swap
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { SwapNeurons } from "../../src/mutate/SwapNeurons.ts";

/**
 * Creates a creature with two distinct hidden neurons suitable for swapping.
 */
function createSwappableCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        squash: "TANH",
        bias: -0.3,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.6 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.7 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("SwapNeurons: creature remains valid after swap", () => {
  const creature = createSwappableCreature();
  creatureValidate(creature);

  const swapNeurons = new SwapNeurons(creature);

  for (let i = 0; i < 50; i++) {
    swapNeurons.mutate();
    creatureValidate(creature);
  }
});

Deno.test("SwapNeurons: swaps bias and squash between neurons", () => {
  const creature = createSwappableCreature();

  // Record initial squash/bias of hidden neurons
  const hiddenNeurons = creature.neurons.filter((n) => n.type === "hidden");
  const initialSquashes = hiddenNeurons.map((n) => n.squash);
  const initialBiases = hiddenNeurons.map((n) => n.bias);

  const swapNeurons = new SwapNeurons(creature);
  let swapped = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (swapNeurons.mutate()) {
      swapped = true;
      break;
    }
  }

  assert(swapped, "Should swap neurons at least once");

  // After swap, the set of {squash, bias} values should be the same
  // but potentially assigned to different neurons
  const afterSquashes = hiddenNeurons.map((n) => n.squash);
  const afterBiases = hiddenNeurons.map((n) => n.bias);

  // The squashes and biases should be a permutation of the originals
  const initialPairs = initialSquashes.map((s, i) => `${s}:${initialBiases[i]}`)
    .sort();
  const afterPairs = afterSquashes.map((s, i) => `${s}:${afterBiases[i]}`)
    .sort();
  assertEquals(
    initialPairs,
    afterPairs,
    "Squash/bias pairs should be the same set after swap (just reordered)",
  );
});

Deno.test("SwapNeurons: returns false with fewer than 2 hidden neurons", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const swapNeurons = new SwapNeurons(creature);

  // With only 1 hidden neuron, swap should always return false
  let swapped = false;
  for (let i = 0; i < 20; i++) {
    if (swapNeurons.mutate()) {
      swapped = true;
    }
  }

  assertEquals(swapped, false, "Should never swap with only 1 hidden neuron");
});

Deno.test("SwapNeurons: returns false with no hidden neurons", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const swapNeurons = new SwapNeurons(creature);
  const result = swapNeurons.mutate();
  assertEquals(result, false, "Should return false with no hidden neurons");
});

Deno.test("SwapNeurons: can be exported and re-imported after swap", () => {
  const creature = createSwappableCreature();

  const swapNeurons = new SwapNeurons(creature);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (swapNeurons.mutate()) break;
  }

  // Round-trip through JSON
  const exported = creature.exportJSON();
  const reimported = Creature.fromJSON(exported);
  creatureValidate(reimported);
  assertEquals(reimported.input, creature.input);
  assertEquals(reimported.output, creature.output);
});

Deno.test("SwapNeurons: UUID remains stable after swap (structural identity preserved)", () => {
  const creature = createSwappableCreature();
  const uuid1 = CreatureUtil.makeUUID(creature);

  const swapNeurons = new SwapNeurons(creature);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (swapNeurons.mutate()) break;
  }

  // The creature's UUID should remain unchanged because swap only changes
  // neuron attributes, which are not part of the structural UUID
  const uuid2 = creature.uuid;
  assertEquals(
    uuid1,
    uuid2,
    "UUID should remain stable because swap preserves structure",
  );
});

Deno.test("SwapNeurons: clears memetic flag on successful swap", () => {
  const creature = createSwappableCreature();
  creature.memetic = { generation: 1, weights: {}, biases: {}, score: 0.5 };

  const swapNeurons = new SwapNeurons(creature);
  let swapped = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    creature.memetic = { generation: 1, weights: {}, biases: {}, score: 0.5 };
    if (swapNeurons.mutate()) {
      swapped = true;
      assertEquals(
        creature.memetic,
        undefined,
        "Memetic flag should be cleared after swap",
      );
      break;
    }
  }

  assert(swapped, "Should swap at least once");
});

Deno.test("SwapNeurons: works with many hidden neurons", () => {
  const creature = new Creature(3, 2, {
    layers: [
      { count: 5, squash: "LOGISTIC" },
      { count: 4, squash: "TANH" },
      { count: 3, squash: "RELU" },
    ],
  });
  creatureValidate(creature);

  const swapNeurons = new SwapNeurons(creature);
  let successCount = 0;
  for (let i = 0; i < 50; i++) {
    if (swapNeurons.mutate()) {
      successCount++;
      creatureValidate(creature);
    }
  }

  assert(
    successCount > 0,
    "Should successfully swap neurons in a multi-layer creature",
  );
});
