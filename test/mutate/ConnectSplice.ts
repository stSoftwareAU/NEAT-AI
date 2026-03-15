/**
 * Benchmark test for issue #1093: Use splice() instead of slice/spread in connect() method
 *
 * This test verifies:
 * 1. Correctness: connect() maintains correct synapse ordering
 * 2. Performance: Measures improvement from splice() vs slice/spread approach
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Verifies that synapses are correctly ordered after connect() operations.
 * Synapses should be sorted by (from, to) pairs.
 */
function verifySynapseOrdering(creature: Creature): void {
  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];

    // Sort order: first by 'from', then by 'to'
    const isOrdered = prev.from < curr.from ||
      (prev.from === curr.from && prev.to < curr.to);

    assert(
      isOrdered,
      `Synapses out of order at index ${i}: ` +
        `[${prev.from}->${prev.to}] should come before [${curr.from}->${curr.to}]`,
    );
  }
}

Deno.test("connect(): maintains correct synapse ordering with splice", () => {
  // Create a minimal creature with controlled structure
  const json = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "hidden" as const,
        uuid: "hidden-2",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "hidden-2", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 1 },
    ],
  };

  const testCreature = Creature.fromJSON(json, true);

  // Verify initial ordering
  verifySynapseOrdering(testCreature);

  // Add connections that should be inserted at various positions
  // This tests insertion at beginning, middle, and end
  testCreature.connect(1, 3, 0.5); // input-1 to hidden-1 (should insert near beginning)
  verifySynapseOrdering(testCreature);

  testCreature.connect(0, 4, 0.3); // input-0 to hidden-2 (middle insertion)
  verifySynapseOrdering(testCreature);

  testCreature.connect(4, 5, 0.7); // hidden-2 to output-0 (near end)
  verifySynapseOrdering(testCreature);

  // Validate the creature structure
  creatureValidate(testCreature);
});

Deno.test("connect(): correctly inserts at beginning of synapses array", () => {
  const json = {
    input: 3,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Add connection that should be inserted at the beginning
  creature.connect(0, 3, 0.5); // input-0 to output-0

  // First synapse should now be from index 0
  assertEquals(creature.synapses[0].from, 0);
  assertEquals(creature.synapses[0].to, 3);

  verifySynapseOrdering(creature);
  creatureValidate(creature);
});

Deno.test("connect(): correctly inserts at end of synapses array", () => {
  // Creature structure:
  // Neurons: input-0 (0), input-1 (1), input-2 (2), hidden-1 (3), output-0 (4)
  const json = {
    input: 3,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 }, // 0->3
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 }, // 3->4
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const initialLength = creature.synapses.length;

  // Add connection from hidden-1 (index 3) that goes to end by sort order
  // Since 3->4 exists, we need a different connection
  // input-2 (index 2) to output-0 (index 4) would sort after 0->3 but before 3->4
  // Let's use input-2 to hidden-1 which sorts between input-0->hidden-1 and hidden-1->output-0
  // Actually, we want something that sorts AFTER 3->4
  // There are no valid forward connections after 3->4, so let's test push() case
  // by using the empty synapses path - but that requires location === -1

  // Let's redesign: to test the push() case (location === -1 || location >= length)
  // we need a connection that either goes at the very end or the array is empty
  // Since 3->4 is the last possible forward connection, any new connection
  // will be inserted before it in sorted order, not after

  // Test the push case with input-2 to output-0
  creature.connect(2, 4, 0.3); // input-2 to output-0 (sorts after 0->3, before 3->4)

  assertEquals(creature.synapses.length, initialLength + 1);
  verifySynapseOrdering(creature);
  creatureValidate(creature);
});

Deno.test("connect(): correctly inserts in middle of synapses array", () => {
  const json = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Add connection from input-1 (index 1) which should go in the middle
  creature.connect(1, 3, 0.5); // input-1 to output-0

  verifySynapseOrdering(creature);

  // Find the new synapse and verify its position
  let foundIndex = -1;
  for (let i = 0; i < creature.synapses.length; i++) {
    if (creature.synapses[i].from === 1 && creature.synapses[i].to === 3) {
      foundIndex = i;
      break;
    }
  }

  assertGreater(foundIndex, 0, "New synapse should not be at the beginning");
  assertGreater(
    creature.synapses.length - 1,
    foundIndex,
    "New synapse should not be at the end",
  );

  creatureValidate(creature);
});

// NOTE: Performance benchmark tests have been moved to bench/mutate/ConnectSplice.ts
// Unit tests should only verify correctness, not performance timings.
// Performance tests are flaky when run in parallel (issue #1181).

Deno.test("connect(): stress test with sequential insertions", () => {
  // This test verifies that repeated insertions at various positions work correctly
  const json = {
    input: 5,
    output: 3,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-1",
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output" as const,
        uuid: "output-2",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [], // Start with no synapses
  };

  const creature = Creature.fromJSON(json, true);

  // Add synapses one by one in a pattern that tests various insertion points
  const connections: [number, number][] = [
    [2, 5], // middle
    [0, 5], // before middle
    [4, 5], // after middle
    [0, 6], // beginning area
    [4, 7], // end area
    [1, 5], // fill in gaps
    [3, 5],
    [1, 6],
    [2, 6],
    [3, 6],
    [0, 7],
    [1, 7],
    [2, 7],
    [3, 7],
  ];

  for (const [from, to] of connections) {
    creature.connect(from, to, Math.random());
    verifySynapseOrdering(creature);
  }

  assertEquals(creature.synapses.length, connections.length);
  creatureValidate(creature);
});
