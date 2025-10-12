import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { SubSelfCon } from "../../src/mutate/SubSelfCon.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SubSelfCon - should not remove only outward connection from hidden neuron", () => {
  // Create a creature with a hidden neuron that only has a self-connection
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0.5,
        index: 2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 3,
      },
    ],
    synapses: [
      // Input to hidden
      {
        from: 0,
        to: 2,
        weight: 1.0,
      },
      // Hidden self-connection (ONLY outward connection)
      {
        from: 2,
        to: 2,
        weight: 0.5,
      },
      // Input to output (to keep output valid)
      {
        from: 0,
        to: 3,
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  });

  // Verify the creature is valid before mutation
  creatureValidate(creature);

  // Hidden neuron at index 2 should have only one outward connection (self)
  const outwardBefore = creature.outwardConnections(2);
  assertEquals(outwardBefore.length, 1);
  assertEquals(outwardBefore[0].from, 2);
  assertEquals(outwardBefore[0].to, 2);

  // Try to mutate - should NOT remove the self-connection
  const mutator = new SubSelfCon(creature);
  const changed = mutator.mutate();

  // Should return false because it can't safely remove the connection
  assertFalse(
    changed,
    "Should not mutate when self-connection is the only outward connection",
  );

  // Verify the creature is still valid
  creatureValidate(creature);

  // Self-connection should still exist
  const outwardAfter = creature.outwardConnections(2);
  assertEquals(outwardAfter.length, 1);
  assertEquals(outwardAfter[0].from, 2);
  assertEquals(outwardAfter[0].to, 2);
});

Deno.test("SubSelfCon - should remove self-connection when neuron has other outward connections", () => {
  // Create a creature with a hidden neuron that has a self-connection AND another outward connection
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0.5,
        index: 2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 3,
      },
    ],
    synapses: [
      // Input to hidden
      {
        from: 0,
        to: 2,
        weight: 1.0,
      },
      // Hidden self-connection
      {
        from: 2,
        to: 2,
        weight: 0.5,
      },
      // Hidden to output (another outward connection)
      {
        from: 2,
        to: 3,
        weight: 1.0,
      },
    ],
    input: 2,
    output: 1,
  });

  // Verify the creature is valid before mutation
  creatureValidate(creature);

  // Hidden neuron at index 2 should have two outward connections
  const outwardBefore = creature.outwardConnections(2);
  assertEquals(outwardBefore.length, 2);

  // Try to mutate - should remove the self-connection
  const mutator = new SubSelfCon(creature);
  const changed = mutator.mutate();

  // Should successfully mutate
  assert(
    changed,
    "Should successfully remove self-connection when other outward connections exist",
  );

  // Verify the creature is still valid
  creatureValidate(creature);

  // Should now have only one outward connection
  const outwardAfter = creature.outwardConnections(2);
  assertEquals(outwardAfter.length, 1);
  assertEquals(outwardAfter[0].to, 3, "Should still have connection to output");
});

Deno.test("SubSelfCon - should allow removal from output neurons", () => {
  // Output neurons can have their self-connections removed
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 2,
      },
    ],
    synapses: [
      // Input to output
      {
        from: 0,
        to: 2,
        weight: 1.0,
      },
      // Output self-connection
      {
        from: 2,
        to: 2,
        weight: 0.5,
      },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Try to mutate
  const mutator = new SubSelfCon(creature);
  const changed = mutator.mutate();

  // Should successfully mutate (output neurons can have self-connections removed)
  assert(changed, "Should remove self-connection from output neuron");

  creatureValidate(creature);

  // Self-connection should be removed
  const outwardAfter = creature.outwardConnections(2);
  assertEquals(
    outwardAfter.length,
    0,
    "Output neuron should have no outward connections after removal",
  );
});

Deno.test("SubSelfCon - stress test with repeated mutations", () => {
  // Run many mutations to ensure we never create an invalid creature
  for (let iteration = 0; iteration < 100; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.5,
          index: 2,
        },
        {
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.3,
          index: 3,
        },
        {
          type: "output",
          squash: "LOGISTIC",
          bias: 0.1,
          index: 4,
        },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.8 },
        { from: 2, to: 2, weight: 0.5 }, // Self-connection on hidden 1
        { from: 2, to: 3, weight: 0.7 },
        { from: 3, to: 3, weight: 0.4 }, // Self-connection on hidden 2
        { from: 3, to: 4, weight: 0.9 },
        { from: 0, to: 4, weight: 0.6 },
      ],
      input: 2,
      output: 1,
    });

    creatureValidate(creature);

    // Attempt multiple mutations
    for (let mut = 0; mut < 10; mut++) {
      const mutator = new SubSelfCon(creature);
      mutator.mutate();

      // Every mutation should result in a valid creature
      creatureValidate(creature);
    }
  }
});

Deno.test("SubSelfCon - stress test with multiple hidden neurons", () => {
  // Test with multiple hidden neurons with self-connections and other connections
  for (let iteration = 0; iteration < 50; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.5,
          index: 2,
        },
        {
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.3,
          index: 3,
        },
        {
          type: "output",
          squash: "LOGISTIC",
          bias: 0.1,
          index: 4,
        },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.8 },
        { from: 2, to: 2, weight: 0.5 }, // Self-connection on hidden 1
        { from: 2, to: 3, weight: 0.7 },
        { from: 3, to: 3, weight: 0.4 }, // Self-connection on hidden 2
        { from: 3, to: 4, weight: 0.9 },
      ],
      input: 2,
      output: 1,
    });

    creatureValidate(creature);

    // Attempt multiple mutations
    for (let mut = 0; mut < 5; mut++) {
      const mutator = new SubSelfCon(creature);
      mutator.mutate();

      // Every mutation should result in a valid creature
      creatureValidate(creature);
    }
  }
});
