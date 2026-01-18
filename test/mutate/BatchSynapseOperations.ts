/**
 * Tests for issue #1102: Batch synapse operations to reduce cache invalidation overhead
 *
 * This test file verifies the functionality and correctness of:
 * 1. connectBatch() - Batch connect multiple synapses with single cache invalidation
 * 2. disconnectBatch() - Batch disconnect multiple synapses with single cache invalidation
 *
 * The tests follow TDD - they define expected behaviour before implementation.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Helper to verify synapses are correctly ordered after operations.
 * Synapses should be sorted by (from, to) pairs.
 */
function verifySynapseOrdering(creature: Creature): void {
  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];

    const isOrdered = prev.from < curr.from ||
      (prev.from === curr.from && prev.to < curr.to);

    assert(
      isOrdered,
      `Synapses out of order at index ${i}: ` +
        `[${prev.from}->${prev.to}] should come before [${curr.from}->${curr.to}]`,
    );
  }
}

/**
 * Helper to create a creature for testing.
 */
function createTestCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);
  const addNeuron = new AddNeuron(creature);

  for (let i = 0; i < hiddenNeurons; i++) {
    addNeuron.mutate();
  }

  return creature;
}

// =============================================================================
// connectBatch() Tests
// =============================================================================

Deno.test("connectBatch(): adds multiple synapses in a single operation", () => {
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
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);
  const initialSynapseCount = creature.synapses.length;

  // Batch connect multiple synapses
  const connections: Array<{
    from: number;
    to: number;
    weight: number;
    type?: "positive" | "negative" | "condition";
  }> = [
    { from: 0, to: 3, weight: 0.5 },
    { from: 1, to: 3, weight: -0.3 },
    { from: 2, to: 4, weight: 0.7 },
    { from: 0, to: 4, weight: 0.1 },
  ];

  creature.connectBatch(connections);

  assertEquals(
    creature.synapses.length,
    initialSynapseCount + connections.length,
  );
  verifySynapseOrdering(creature);
  creatureValidate(creature);
});

Deno.test("connectBatch(): maintains correct synapse ordering", () => {
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
    synapses: [
      { fromUUID: "input-2", toUUID: "output-1", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Add connections in random order - they should be sorted correctly
  const connections = [
    { from: 4, to: 7, weight: 0.1 }, // Last by sort order
    { from: 0, to: 5, weight: 0.2 }, // First by sort order
    { from: 2, to: 5, weight: 0.3 }, // Middle
    { from: 0, to: 6, weight: 0.4 }, // After 0->5
  ];

  creature.connectBatch(connections);

  verifySynapseOrdering(creature);
  creatureValidate(creature);
});

Deno.test("connectBatch(): handles empty array", () => {
  const creature = new Creature(2, 1);
  const initialSynapseCount = creature.synapses.length;

  creature.connectBatch([]);

  assertEquals(creature.synapses.length, initialSynapseCount);
  creatureValidate(creature);
});

Deno.test("connectBatch(): handles single connection", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);

  creature.connectBatch([{ from: 0, to: 2, weight: 0.5 }]);

  assertEquals(creature.synapses.length, 1);
  assertEquals(creature.synapses[0].from, 0);
  assertEquals(creature.synapses[0].to, 2);
  creatureValidate(creature);
});

Deno.test("connectBatch(): supports synapse types", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);

  creature.connectBatch([
    { from: 0, to: 2, weight: 0.5, type: "positive" },
    { from: 1, to: 2, weight: -0.3, type: "negative" },
  ]);

  assertEquals(creature.synapses.length, 2);
  assertEquals(creature.synapses[0].type, "positive");
  assertEquals(creature.synapses[1].type, "negative");
  creatureValidate(creature);
});

Deno.test("connectBatch(): throws on duplicate connections within batch", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);

  assertThrows(
    () => {
      creature.connectBatch([
        { from: 0, to: 2, weight: 0.5 },
        { from: 0, to: 2, weight: 0.3 }, // Duplicate
      ]);
    },
    Error,
    "already exists",
  );
});

Deno.test("connectBatch(): throws on existing connections", () => {
  const json = {
    input: 2,
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
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  assertThrows(
    () => {
      creature.connectBatch([
        { from: 0, to: 2, weight: 0.5 }, // Already exists
      ]);
    },
    Error,
    "already exists",
  );
});

// =============================================================================
// disconnectBatch() Tests
// =============================================================================

Deno.test("disconnectBatch(): removes multiple synapses in a single operation", () => {
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
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const initialSynapseCount = creature.synapses.length;
  assertEquals(initialSynapseCount, 6);

  // Batch disconnect
  creature.disconnectBatch([
    { from: 0, to: 3 },
    { from: 1, to: 4 },
    { from: 2, to: 3 },
  ]);

  assertEquals(creature.synapses.length, 3);
  verifySynapseOrdering(creature);
});

Deno.test("disconnectBatch(): maintains correct synapse ordering", () => {
  const json = {
    input: 4,
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
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-3", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-3", toUUID: "output-1", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Remove from various positions to test ordering maintenance
  creature.disconnectBatch([
    { from: 1, to: 4 }, // Middle
    { from: 3, to: 5 }, // Near end
    { from: 0, to: 4 }, // Beginning of second group
  ]);

  verifySynapseOrdering(creature);
});

Deno.test("disconnectBatch(): handles empty array", () => {
  const creature = new Creature(2, 1);
  const initialSynapseCount = creature.synapses.length;

  creature.disconnectBatch([]);

  assertEquals(creature.synapses.length, initialSynapseCount);
});

Deno.test("disconnectBatch(): handles single disconnection", () => {
  const json = {
    input: 2,
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
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  creature.disconnectBatch([{ from: 0, to: 2 }]);

  assertEquals(creature.synapses.length, 1);
  assertEquals(creature.synapses[0].from, 1);
  assertEquals(creature.synapses[0].to, 2);
});

Deno.test("disconnectBatch(): silently ignores non-existent connections", () => {
  const json = {
    input: 2,
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
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // This should not throw - non-existent connections are silently ignored
  creature.disconnectBatch([
    { from: 1, to: 2 }, // Does not exist
  ]);

  assertEquals(creature.synapses.length, 1);
});

Deno.test("disconnectBatch(): handles mix of existent and non-existent connections", () => {
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
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  creature.disconnectBatch([
    { from: 0, to: 3 }, // Exists
    { from: 0, to: 4 }, // Does not exist (no such neuron)
    { from: 2, to: 3 }, // Exists
  ]);

  assertEquals(creature.synapses.length, 1);
  assertEquals(creature.synapses[0].from, 1);
  assertEquals(creature.synapses[0].to, 3);
});

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test("connectBatch() + disconnectBatch(): work together correctly", () => {
  const json = {
    input: 4,
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
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);

  // Add some connections
  creature.connectBatch([
    { from: 0, to: 4, weight: 0.5 },
    { from: 1, to: 4, weight: 0.3 },
    { from: 2, to: 5, weight: 0.7 },
    { from: 3, to: 5, weight: 0.1 },
  ]);

  assertEquals(creature.synapses.length, 4);
  verifySynapseOrdering(creature);

  // Remove some connections
  creature.disconnectBatch([
    { from: 1, to: 4 },
    { from: 3, to: 5 },
  ]);

  assertEquals(creature.synapses.length, 2);
  verifySynapseOrdering(creature);
  creatureValidate(creature);
});

Deno.test("batch operations: produce same result as individual operations", () => {
  // Create two identical creatures
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
    synapses: [],
  };

  const creature1 = Creature.fromJSON(json, true);
  const creature2 = Creature.fromJSON(json, true);

  const connections = [
    { from: 0, to: 3, weight: 0.5 },
    { from: 1, to: 4, weight: 0.3 },
    { from: 2, to: 3, weight: 0.7 },
  ];

  // Creature 1: Use batch operation
  creature1.connectBatch(connections);

  // Creature 2: Use individual operations
  for (const conn of connections) {
    creature2.connect(conn.from, conn.to, conn.weight);
  }

  // Verify both have the same synapses
  assertEquals(creature1.synapses.length, creature2.synapses.length);

  for (let i = 0; i < creature1.synapses.length; i++) {
    assertEquals(creature1.synapses[i].from, creature2.synapses[i].from);
    assertEquals(creature1.synapses[i].to, creature2.synapses[i].to);
    assertEquals(creature1.synapses[i].weight, creature2.synapses[i].weight);
  }
});

Deno.test("batch operations: large creature stress test", () => {
  const creature = createTestCreature(20, 5, 50);

  // Get available connections
  const available = creature.getAvailableConnections();
  const toAdd = Math.min(100, available.length);

  const connections = available.slice(0, toAdd).map(([from, to]) => ({
    from,
    to,
    weight: Math.random() * 2 - 1,
  }));

  const initialCount = creature.synapses.length;
  creature.connectBatch(connections);

  assertEquals(creature.synapses.length, initialCount + toAdd);
  verifySynapseOrdering(creature);
  creatureValidate(creature);

  // Now disconnect some
  const toRemove = connections.slice(0, 50).map((c) => ({
    from: c.from,
    to: c.to,
  }));

  creature.disconnectBatch(toRemove);

  assertEquals(creature.synapses.length, initialCount + toAdd - 50);
  verifySynapseOrdering(creature);
  creatureValidate(creature);
});
