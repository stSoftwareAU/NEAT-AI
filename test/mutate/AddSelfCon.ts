import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddSelfCon } from "../../src/mutate/AddSelfCon.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("AddSelfCon - should add self-connection to hidden neuron", () => {
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

  const synapsesBeforeCount = creature.synapses.length;
  const mutator = new AddSelfCon(creature);
  const changed = mutator.mutate();

  assert(changed, "Should successfully add a self-connection");
  assertEquals(
    creature.synapses.length,
    synapsesBeforeCount + 1,
    "Should have one more synapse",
  );

  // Verify self-connection exists
  const selfCon = creature.selfConnection(2);
  assert(selfCon !== null, "Hidden neuron should now have a self-connection");

  creatureValidate(creature);
});

Deno.test("AddSelfCon - should return false when all hidden neurons already have self-connections", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 2, weight: 0.3 }, // Already has self-connection
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const mutator = new AddSelfCon(creature);
  const changed = mutator.mutate();

  assertFalse(
    changed,
    "Should return false when all neurons already have self-connections",
  );
  creatureValidate(creature);
});

Deno.test("AddSelfCon - should skip constant neurons", () => {
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

  const mutator = new AddSelfCon(creature);
  const changed = mutator.mutate();

  assertFalse(changed, "Should not add self-connections to constant neurons");
  creatureValidate(creature);
});

Deno.test("AddSelfCon - should not add self-connection to output neurons", () => {
  // AddSelfCon only operates on hidden neurons (input to length - output)
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

  const mutator = new AddSelfCon(creature);
  const changed = mutator.mutate();

  assertFalse(changed, "Should not add self-connections to output neurons");
  creatureValidate(creature);
});

Deno.test("AddSelfCon - should delete memetic property after mutation", () => {
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

  creature.memetic = { test: true } as unknown as typeof creature.memetic;
  creatureValidate(creature);

  const mutator = new AddSelfCon(creature);
  const changed = mutator.mutate();

  if (changed) {
    assertEquals(creature.memetic, undefined, "Memetic should be deleted");
  }
  creatureValidate(creature);
});

Deno.test("AddSelfCon - stress test produces valid creatures", () => {
  for (let iteration = 0; iteration < 50; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
        { type: "hidden", squash: "TANH", bias: 0.3, index: 3 },
        { type: "output", squash: "LOGISTIC", bias: 0.1, index: 4 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 3, weight: 0.8 },
        { from: 2, to: 4, weight: 0.9 },
        { from: 3, to: 4, weight: 0.7 },
      ],
      input: 2,
      output: 1,
    });

    creatureValidate(creature);

    const mutator = new AddSelfCon(creature);
    mutator.mutate();

    creatureValidate(creature);
  }
});

Deno.test("AddSelfCon - focus list limits available neurons", () => {
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

  // Focus only on neuron at index 2
  const mutator = new AddSelfCon(creature);
  const changed = mutator.mutate([2]);

  if (changed) {
    // Verify the self-connection was added to the focused neuron
    const selfCon = creature.selfConnection(2);
    assert(selfCon !== null, "Self-connection should be on the focused neuron");
  }

  creatureValidate(creature);
});
