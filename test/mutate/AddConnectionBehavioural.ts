/**
 * Behavioural tests for the AddConnection mutation operator.
 *
 * Issue #1441: Verifies that:
 * 1. AddConnection creates valid new connections
 * 2. AddConnection respects the forward-only constraint
 * 3. Creature remains valid after adding a connection
 * 4. Returns false when no connections are available
 * 5. New synapses have finite weights
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";

/**
 * Creates a simple creature with room for additional connections.
 */
function createSparseCreature(): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        squash: "TANH",
        bias: 0.2,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.4 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.6 },
    ],
  };
  return Creature.fromJSON(json);
}

/**
 * Creates a fully-connected creature where no new connections are possible.
 */
function createFullyConnectedCreature(): Creature {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("AddConnection: creates a new valid connection", () => {
  const creature = createSparseCreature();
  creatureValidate(creature);
  const synapseCountBefore = creature.synapses.length;

  const addConn = new AddConnection(creature);
  let added = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (addConn.mutate()) {
      added = true;
      break;
    }
  }

  assert(added, "Should successfully add a connection to a sparse creature");
  assert(
    creature.synapses.length > synapseCountBefore,
    "Synapse count should increase after adding a connection",
  );
  creatureValidate(creature);
});

Deno.test("AddConnection: new synapse has a finite weight", () => {
  const creature = createSparseCreature();
  const existingFromTo = new Set(
    creature.synapses.map((s) => `${s.from}-${s.to}`),
  );

  const addConn = new AddConnection(creature);
  let added = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (addConn.mutate()) {
      added = true;
      break;
    }
  }

  assert(added, "Should add a connection");

  // Find the newly added synapse
  for (const synapse of creature.synapses) {
    const key = `${synapse.from}-${synapse.to}`;
    if (!existingFromTo.has(key)) {
      assert(
        Number.isFinite(synapse.weight),
        `New synapse weight must be finite, got ${synapse.weight}`,
      );
    }
  }
});

Deno.test("AddConnection: returns false when fully connected", () => {
  const creature = createFullyConnectedCreature();
  creatureValidate(creature);

  const addConn = new AddConnection(creature);
  const result = addConn.mutate();

  assertEquals(
    result,
    false,
    "Should return false when no connections available",
  );
});

Deno.test("AddConnection: respects forward-only constraint", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        squash: "TANH",
        bias: 0.2,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.6 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.8 },
    ],
  };

  const creature = Creature.fromJSON(json);
  creature.forwardOnly = true;
  creatureValidate(creature);

  // Run many mutations — all must maintain forward-only invariant
  for (let i = 0; i < 50; i++) {
    // Clone to reset between iterations
    const clone = Creature.fromJSON(creature.exportJSON());
    clone.forwardOnly = true;
    const addConnClone = new AddConnection(clone);

    if (addConnClone.mutate()) {
      // Verify forward-only: all synapses have from < to
      for (const synapse of clone.synapses) {
        assert(
          synapse.from < synapse.to,
          `Forward-only violation after AddConnection: ${synapse.from} -> ${synapse.to}`,
        );
      }
      creatureValidate(clone);
    }
  }
});

Deno.test("AddConnection: creature remains valid after multiple additions", () => {
  const creature = createSparseCreature();
  creatureValidate(creature);

  const addConn = new AddConnection(creature);

  // Add connections until we cannot add more
  let addedCount = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (addConn.mutate()) {
      addedCount++;
      creatureValidate(creature);
    }
  }

  assert(addedCount > 0, "Should add at least one connection");
});

Deno.test("AddConnection: clears memetic flag on successful mutation", () => {
  const creature = createSparseCreature();
  creature.memetic = { generation: 1, weights: {}, biases: {}, score: 0.5 };

  const addConn = new AddConnection(creature);
  let added = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (addConn.mutate()) {
      added = true;
      break;
    }
  }

  assert(added, "Should add a connection");
  assertEquals(
    creature.memetic,
    undefined,
    "Memetic flag should be cleared after structural mutation",
  );
});

Deno.test("AddConnection: can use weightScale option", () => {
  const creature = createSparseCreature();
  const existingFromTo = new Set(
    creature.synapses.map((s) => `${s.from}-${s.to}`),
  );

  const addConn = new AddConnection(creature);
  let added = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (addConn.mutate(undefined, { weightScale: 0.01 })) {
      added = true;
      break;
    }
  }

  assert(added, "Should add a connection with small weight scale");

  // The new connection should have a relatively small weight
  for (const synapse of creature.synapses) {
    const key = `${synapse.from}-${synapse.to}`;
    if (!existingFromTo.has(key)) {
      // With weightScale 0.01, the weight should be small
      assert(
        Math.abs(synapse.weight) < 1,
        `Weight with scale 0.01 should be small, got ${synapse.weight}`,
      );
    }
  }
  creatureValidate(creature);
});
