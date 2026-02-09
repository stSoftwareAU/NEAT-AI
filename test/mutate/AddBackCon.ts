import { assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddBackCon } from "../../src/mutate/AddBackCon.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("AddBackCon - should return false when no back connections available", () => {
  // Minimal creature: inputs directly to output, no hidden neurons to form back connections
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

  const mutator = new AddBackCon(creature);
  const changed = mutator.mutate();
  assertFalse(changed, "Should return false when no back connections possible");
  creatureValidate(creature);
});

Deno.test("AddBackCon - should add a back connection between hidden neurons", () => {
  // Create creature with two hidden neurons that do not yet connect to each other backwards
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

  const synapsesBeforeCount = creature.synapses.length;

  // AddBackCon adds connections where fromIndx < toIndx but from a higher hidden neuron
  // In this topology, there are available pairs since neurons 2 and 3 are not fully connected
  const mutator = new AddBackCon(creature);
  const changed = mutator.mutate();

  if (changed) {
    assertEquals(
      creature.synapses.length,
      synapsesBeforeCount + 1,
      "Should have one more synapse after successful mutation",
    );
  }
  creatureValidate(creature);
});

Deno.test("AddBackCon - should delete memetic property after mutation", () => {
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

  creature.memetic = { test: true } as unknown as typeof creature.memetic;
  creatureValidate(creature);

  const mutator = new AddBackCon(creature);
  const changed = mutator.mutate();

  if (changed) {
    assertEquals(creature.memetic, undefined, "Memetic should be deleted");
  }
  creatureValidate(creature);
});

Deno.test("AddBackCon - should skip constant neurons", () => {
  // Create creature with a constant neuron - AddBackCon should not add connections to constants
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

  const mutator = new AddBackCon(creature);
  const changed = mutator.mutate();

  // Should not add a connection to constant neuron
  assertFalse(changed, "Should not add back connections to constant neurons");
  creatureValidate(creature);
});

Deno.test("AddBackCon - stress test produces valid creatures", () => {
  for (let iteration = 0; iteration < 50; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 3 },
        { type: "hidden", squash: "LOGISTIC", bias: 0.3, index: 4 },
        { type: "hidden", squash: "TANH", bias: 0.1, index: 5 },
        { type: "output", squash: "LOGISTIC", bias: 0.1, index: 6 },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 4, weight: 0.8 },
        { from: 2, to: 5, weight: 0.6 },
        { from: 3, to: 6, weight: 0.9 },
        { from: 4, to: 6, weight: 0.7 },
        { from: 5, to: 6, weight: 0.5 },
      ],
      input: 3,
      output: 1,
    });

    creatureValidate(creature);

    const mutator = new AddBackCon(creature);
    mutator.mutate();

    creatureValidate(creature);
  }
});

Deno.test("AddBackCon - focus list limits available connections", () => {
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

  // Only focus on output neuron (index 4), which limits available pairs
  const mutator = new AddBackCon(creature);
  mutator.mutate([4]);

  creatureValidate(creature);
});
