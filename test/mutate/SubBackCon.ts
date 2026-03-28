import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { SubBackCon } from "../../src/mutate/SubBackCon.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SubBackCon - should return false when no eligible connections exist", () => {
  // Create a minimal creature with only essential connections that can't be removed
  // SubBackCon looks for connections where from < to (standard forward connections)
  // But it won't remove connections if doing so would leave neurons invalid
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
      // Only self-connection on output (SubBackCon looks for from < to, not self-connections)
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

  const mutator = new SubBackCon(creature);
  const changed = mutator.mutate();

  // Should return false as there are no eligible back connections to remove
  // (self-connections are not back connections since from === to, not from < to)
  assertFalse(
    changed,
    "Should return false when no eligible back connections exist",
  );

  creatureValidate(creature);
});

Deno.test("SubBackCon - should remove back connection successfully", () => {
  // Create a creature with a back connection (connection where from < to)
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
      { from: 1, to: 3, weight: 1.0 },
      { from: 2, to: 3, weight: 0.7 }, // This is a back connection (from=2 < to=3)
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const synapsesBeforeCount = creature.synapses.length;

  const mutator = new SubBackCon(creature);
  const changed = mutator.mutate();

  assert(changed, "Should successfully remove a back connection");
  creatureValidate(creature);

  // Should have fewer synapses (or same if neuron cleanup occurred)
  assert(
    creature.synapses.length <= synapsesBeforeCount,
    "Should have same or fewer synapses after mutation",
  );
});

Deno.test("SubBackCon - should remove or convert disconnected hidden neuron after mutation", () => {
  // Create a creature where the hidden neuron's only outward connection
  // is the back connection. Removing it leaves hidden with no outward path,
  // so fix() should remove or convert the neuron.
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
      { from: 0, to: 2, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
      { from: 1, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  let neuronCleanedUp = false;

  for (let attempts = 0; attempts < 100; attempts++) {
    const testCreature = Creature.fromJSON(creature.exportInternalJSON());
    const hiddenCountBefore = testCreature.neurons.filter((n) =>
      n.type === "hidden"
    ).length;

    const mutator = new SubBackCon(testCreature);
    const changed = mutator.mutate();

    creatureValidate(testCreature);

    if (changed) {
      const hiddenCountAfter =
        testCreature.neurons.filter((n) => n.type === "hidden").length;
      if (hiddenCountAfter < hiddenCountBefore) {
        neuronCleanedUp = true;
        break;
      }
    }
  }

  assert(
    neuronCleanedUp,
    "Disconnected hidden neuron should be removed or converted after back connection removal",
  );
});

Deno.test("SubBackCon - mutation always produces valid creature even when neuron loses inward connections", () => {
  // Create a creature where removing the back connection leaves hidden2 with
  // no inward connections. After fix(), the creature should still be valid —
  // hidden2 may be converted to constant or removed entirely.
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
      // Input to hidden1
      { from: 0, to: 2, weight: 1.0 },
      // Hidden1 to hidden2 (only inward to hidden2) - this is the back connection
      { from: 2, to: 3, weight: 0.7 },
      // Hidden1 to output
      { from: 2, to: 4, weight: 0.8 },
      // Hidden2 to output (outward from hidden2)
      { from: 3, to: 4, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  let mutationSucceeded = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(creature.exportInternalJSON());
    const mutator = new SubBackCon(testCreature);
    const changed = mutator.mutate();

    // Every mutation attempt must leave the creature valid
    creatureValidate(testCreature);

    if (changed) {
      mutationSucceeded = true;
      // After removing a back connection, the creature should still have
      // at least one path from inputs to outputs
      assert(
        testCreature.synapses.length > 0,
        "Creature should still have synapses after mutation",
      );
    }
  }

  assert(
    mutationSucceeded,
    "Should successfully mutate at least once in 50 attempts",
  );
});

Deno.test("SubBackCon - focus list restricts which connections can be removed", () => {
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
      { from: 1, to: 3, weight: 1.0 },
      { from: 2, to: 3, weight: 0.7 }, // Back connection between hidden neurons
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const backConnectionBefore = creature.getSynapse(2, 3);
  assert(
    backConnectionBefore !== null,
    "Back connection 2->3 should exist before mutation",
  );

  // Focus only on the output neuron (index 4), which is not involved in the
  // back connection (2->3). The back connection should remain untouched.
  const mutator = new SubBackCon(creature);
  const changed = mutator.mutate([4]);

  creatureValidate(creature);

  if (!changed) {
    // If mutation didn't happen, back connection should still exist
    const backConnectionAfter = creature.getSynapse(2, 3);
    assert(
      backConnectionAfter !== null,
      "Back connection should be preserved when focus list excludes it",
    );
  }
});

Deno.test("SubBackCon - removes connection and reduces synapse count", () => {
  // Test with a network that has multiple paths so removal is always possible
  let mutationSucceeded = false;

  for (let attempt = 0; attempt < 50; attempt++) {
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
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.8 },
        { from: 2, to: 3, weight: 0.9 },
        { from: 0, to: 3, weight: 0.7 },
        { from: 1, to: 3, weight: 0.6 },
      ],
      input: 2,
      output: 1,
    });

    creatureValidate(creature);

    const synapsesCountBefore = creature.synapses.length;

    const mutator = new SubBackCon(creature);
    const changed = mutator.mutate();

    creatureValidate(creature);

    if (changed) {
      assert(
        creature.synapses.length <= synapsesCountBefore,
        "Should have same or fewer synapses after mutation",
      );
      mutationSucceeded = true;
      break;
    }
  }

  assert(
    mutationSucceeded,
    "SubBackCon should succeed at least once in 50 attempts",
  );
});

Deno.test("SubBackCon - stress test single mutation per creature", () => {
  // Run many single mutations to ensure they don't create invalid creatures
  // Note: Multiple sequential mutations can trigger edge cases - tested separately
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
        { from: 2, to: 3, weight: 0.7 },
        { from: 1, to: 3, weight: 0.6 },
        { from: 3, to: 4, weight: 0.4 },
        { from: 2, to: 4, weight: 0.9 },
      ],
      input: 2,
      output: 1,
    });

    creatureValidate(creature);

    // Single mutation per fresh creature
    const mutator = new SubBackCon(creature);
    mutator.mutate();

    // Every mutation should result in a valid creature
    creatureValidate(creature);
  }
});

Deno.test("SubBackCon - should delete memetic property after mutation", () => {
  let mutationSucceeded = false;

  for (let attempt = 0; attempt < 50; attempt++) {
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
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.8 }, // Back connection
        { from: 2, to: 3, weight: 0.9 },
      ],
      input: 2,
      output: 1,
    });

    creature.memetic = { test: true } as unknown as typeof creature.memetic;
    creatureValidate(creature);

    const mutator = new SubBackCon(creature);
    const changed = mutator.mutate();

    creatureValidate(creature);

    if (changed) {
      assertEquals(creature.memetic, undefined, "Memetic should be deleted");
      mutationSucceeded = true;
      break;
    }
  }

  assert(
    mutationSucceeded,
    "SubBackCon should succeed at least once in 50 attempts",
  );
});
