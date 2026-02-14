/**
 * Tests for issue #1036: Performance optimisation for ADD_CONNECTION mutation
 *
 * The optimisation replaces O(n²) connection search with Set-based O(1) lookup.
 */
import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("AddConnection: getConnectionSet returns correct existing connections", () => {
  const creature = new Creature(3, 2);
  creatureValidate(creature);

  // Get the connection set
  const connectionSet = creature.getConnectionSet();

  // For a 3-input, 2-output creature, each input should connect to each output
  // That's 3 * 2 = 6 connections
  assertEquals(connectionSet.size, 6);

  // Verify specific connections exist
  // Input neurons are indices 0, 1, 2
  // Output neurons are indices 3, 4 (since there are no hidden neurons)
  for (let from = 0; from < 3; from++) {
    for (let to = 3; to < 5; to++) {
      const key = `${from}-${to}`;
      assertEquals(
        connectionSet.has(key),
        true,
        `Expected connection ${key} to exist`,
      );
    }
  }
});

Deno.test("AddConnection: getConnectionSet updates after adding connection", () => {
  const creature = new Creature(2, 1, { lazyInitialization: true });
  // Create input neurons
  creature.neurons = [];
  creature.synapses = [];

  // Manually set up a minimal creature for testing
  const json = {
    input: 2,
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
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const testCreature = Creature.fromJSON(json, true);

  // Get initial connection set
  const initialSet = testCreature.getConnectionSet();
  assertEquals(initialSet.size, 2);

  // Add a new connection
  testCreature.connect(0, 3, 0.5); // input-0 to output

  // Get updated connection set (should invalidate cache)
  const updatedSet = testCreature.getConnectionSet();
  assertEquals(updatedSet.size, 3);
  assertEquals(updatedSet.has("0-3"), true);
});

Deno.test("AddConnection: hasConnection provides O(1) lookup", () => {
  const creature = new Creature(3, 2);
  creatureValidate(creature);

  // Test existing connections
  for (let from = 0; from < 3; from++) {
    for (let to = 3; to < 5; to++) {
      assertEquals(
        creature.hasConnection(from, to),
        true,
        `Expected connection ${from}->${to} to exist`,
      );
    }
  }

  // Test non-existing connections
  assertEquals(creature.hasConnection(0, 0), false); // self-connection
  assertEquals(creature.hasConnection(0, 1), false); // input to input
  assertEquals(creature.hasConnection(3, 0), false); // output to input
});

Deno.test("AddConnection: hasConnection cache invalidates on structure change", () => {
  const json = {
    input: 2,
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
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Verify initial state
  assertEquals(creature.hasConnection(0, 2), true); // input-0 to hidden
  assertEquals(creature.hasConnection(1, 2), false); // input-1 to hidden doesn't exist
  assertEquals(creature.hasConnection(0, 3), false); // input-0 to output doesn't exist

  // Add a new connection
  creature.connect(1, 2, 0.5); // input-1 to hidden

  // Cache should be invalidated and new connection should be found
  assertEquals(creature.hasConnection(1, 2), true);
});

Deno.test("AddConnection: mutation still works correctly with optimisation", () => {
  const creature = new Creature(2, 1);
  creatureValidate(creature);

  const addNeuron = new AddNeuron(creature);
  for (let i = 5; i--;) {
    addNeuron.mutate();
  }

  const initialSynapseCount = creature.synapses.length;

  const addConnection = new AddConnection(creature);
  let connectionsAdded = 0;
  for (let i = 10; i--;) {
    if (addConnection.mutate()) {
      connectionsAdded++;
    }
  }

  // Should have added some connections
  assertGreater(connectionsAdded, 0);
  assertEquals(
    creature.synapses.length,
    initialSynapseCount + connectionsAdded,
  );

  // Creature should still be valid
  creatureValidate(creature);
});

Deno.test("AddConnection: mutation works correctly with large creature", () => {
  // Create a creature with many neurons to test mutation behaviour at scale
  const creature = new Creature(10, 5);
  creatureValidate(creature);

  const addNeuron = new AddNeuron(creature);
  for (let i = 50; i--;) {
    addNeuron.mutate();
  }

  const initialSynapseCount = creature.synapses.length;

  const addConnection = new AddConnection(creature);
  let connectionsAdded = 0;
  for (let i = 100; i--;) {
    if (addConnection.mutate()) {
      connectionsAdded++;
    }
  }

  // Creature should still be valid after many mutations
  creatureValidate(creature);

  // Synapse count should reflect added connections
  assertEquals(
    creature.synapses.length,
    initialSynapseCount + connectionsAdded,
    "Synapse count should match initial count plus added connections",
  );
});

Deno.test("AddConnection: getAvailableConnections returns valid pairs", () => {
  const json = {
    input: 2,
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
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  // Neurons: input-0 (0), input-1 (1), hidden-1 (2), output-0 (3)
  // Existing connections: 0->2, 2->3
  // Available forward-only connections:
  // - 0->3 (input to output)
  // - 1->2 (input to hidden)
  // - 1->3 (input to output)

  const available = creature.getAvailableConnections();

  // Should have 3 available connections
  assertEquals(available.length, 3);

  // Verify that none of the available connections already exist
  const connectionSet = creature.getConnectionSet();
  for (const [from, to] of available) {
    const key = `${from}-${to}`;
    assertEquals(
      connectionSet.has(key),
      false,
      `Connection ${key} should not already exist`,
    );
  }

  // Verify all are forward-only (from < to)
  for (const [from, to] of available) {
    assertGreater(to, from, `Connection ${from}->${to} should be forward-only`);
  }
});

Deno.test("AddConnection: getAvailableConnections excludes constant neurons", () => {
  // Constant neurons don't have a squash function
  const json = {
    input: 2,
    output: 1,
    neurons: [
      { type: "constant" as const, uuid: "const-1", bias: 1 },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "const-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(json, true);

  const available = creature.getAvailableConnections();

  // Should not include any connections TO the constant neuron
  for (const [, to] of available) {
    const neuron = creature.neurons[to];
    assertEquals(
      neuron.type !== "constant",
      true,
      `Should not connect to constant neuron at index ${to}`,
    );
  }
});
