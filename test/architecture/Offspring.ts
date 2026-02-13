/**
 * Unit tests for Offspring breeding.
 *
 * Issue #1407: Targeted unit tests for architecture core - offspring creation
 * from parent creatures, including compatible/incompatible breeding, topology
 * sorting, and forward-only enforcement.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../mod.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import type { SynapseInternal } from "../../src/architecture/SynapseInterfaces.ts";

// --- Offspring.breed tests ---

Deno.test("Offspring.breed - produces offspring from compatible parents", () => {
  const mum = new Creature(3, 2, {
    layers: [
      { count: 4, squash: "IDENTITY" },
      { count: 3, squash: "LOGISTIC" },
    ],
  });
  const dad = new Creature(3, 2, {
    layers: [
      { count: 4, squash: "LOGISTIC" },
      { count: 3, squash: "IDENTITY" },
    ],
  });

  // Try multiple times since breeding involves randomness
  let offspring: Creature | undefined;
  for (let i = 0; i < 50; i++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  // At least one attempt should succeed with compatible parents
  assert(
    offspring !== undefined,
    "Should produce offspring from compatible parents",
  );
  assertEquals(offspring.input, 3);
  assertEquals(offspring.output, 2);
});

Deno.test("Offspring.breed - parents must have same input/output counts", () => {
  const mum = new Creature(2, 1);
  const dad = new Creature(3, 1);

  assertThrows(
    () => Offspring.breed(mum, dad),
    Error,
    "same species",
  );
});

Deno.test("Offspring.breed - parents must have matching output count", () => {
  const mum = new Creature(2, 1);
  const dad = new Creature(2, 2);

  assertThrows(
    () => Offspring.breed(mum, dad),
    Error,
    "same species",
  );
});

Deno.test("Offspring.breed - returns undefined when offspring clones parent", () => {
  // Minimal creatures are likely to produce clones
  const mum = new Creature(1, 1);
  const dad = new Creature(1, 1);

  // With minimal structure, offspring often equals a parent
  let cloneCount = 0;
  for (let i = 0; i < 50; i++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring === undefined) {
      cloneCount++;
    }
  }

  // With minimal creatures, some attempts should return undefined (clones)
  assert(
    cloneCount > 0,
    "Minimal creatures should sometimes produce clones (returning undefined)",
  );
});

Deno.test("Offspring.breed - offspring has valid synapses", () => {
  const mum = new Creature(2, 1, {
    layers: [{ count: 3, squash: "IDENTITY" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 3, squash: "IDENTITY" }],
  });

  let offspring: Creature | undefined;
  for (let i = 0; i < 20; i++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  if (offspring) {
    assert(offspring.synapses.length > 0, "Offspring should have synapses");
    // All synapse indices should be in bounds
    for (const s of offspring.synapses) {
      assert(
        s.from >= 0 && s.from < offspring.neurons.length,
        "from index in bounds",
      );
      assert(
        s.to >= 0 && s.to < offspring.neurons.length,
        "to index in bounds",
      );
      assert(s.from <= s.to, "Forward-only: from <= to");
    }
  }
});

Deno.test("Offspring.breed - offspring gets a UUID", () => {
  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  let offspring: Creature | undefined;
  for (let i = 0; i < 20; i++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  if (offspring) {
    assert(offspring.uuid !== undefined, "Offspring should have a UUID");
    assert(offspring.uuid.length > 0, "UUID should be non-empty");
  }
});

Deno.test("Offspring.breed - with forwardOnly option", () => {
  const mum = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const dad = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  let offspring: Creature | undefined;
  for (let i = 0; i < 20; i++) {
    offspring = Offspring.breed(mum, dad, { forwardOnly: true });
    if (offspring) break;
  }

  if (offspring) {
    // Forward-only offspring should not have backward connections
    for (const s of offspring.synapses) {
      assert(s.from <= s.to, "Forward-only: from must be <= to");
    }
  }
});

// --- Offspring.cloneConnections tests ---

Deno.test("Offspring.cloneConnections - converts internal to export format", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });

  const internalConns: SynapseInternal[] = creature.synapses.map((s) => ({
    from: s.from,
    to: s.to,
    weight: s.weight,
    type: s.type,
    tags: s.tags,
  }));

  const exported = Offspring.cloneConnections(creature, internalConns);

  assertEquals(exported.length, internalConns.length);
  for (let i = 0; i < exported.length; i++) {
    assertEquals(
      exported[i].fromUUID,
      creature.neurons[internalConns[i].from].uuid,
    );
    assertEquals(
      exported[i].toUUID,
      creature.neurons[internalConns[i].to].uuid,
    );
    assertEquals(exported[i].weight, internalConns[i].weight);
  }
});

Deno.test("Offspring.cloneConnections - empty connections list", () => {
  const creature = new Creature(2, 1);
  const exported = Offspring.cloneConnections(creature, []);

  assertEquals(exported.length, 0);
});

// --- Offspring.sortNeurons tests ---

Deno.test("Offspring.sortNeurons - keeps input before hidden before output", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });

  // Create a child array replicating the mother's structure
  const child = [...creature.neurons];
  const connectionsMap = new Map<
    string,
    Array<{ fromUUID: string; toUUID: string; weight: number }>
  >();

  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      const conns = creature.inwardConnections(neuron.index);
      connectionsMap.set(
        neuron.uuid,
        conns.map((c) => ({
          fromUUID: creature.neurons[c.from].uuid,
          toUUID: creature.neurons[c.to].uuid,
          weight: c.weight,
        })),
      );
    }
  }

  Offspring.sortNeurons(
    child,
    creature.neurons,
    creature.neurons,
    connectionsMap,
  );

  // Verify ordering: inputs first, then hidden, then output
  let foundHidden = false;
  let foundOutput = false;
  for (const neuron of child) {
    if (neuron.type === "hidden" || neuron.type === "constant") {
      assert(!foundOutput, "Hidden neurons must come before output neurons");
      foundHidden = true;
    }
    if (neuron.type === "output") {
      foundOutput = true;
    }
    if (neuron.type === "input") {
      assert(!foundHidden && !foundOutput, "Input neurons must come first");
    }
  }
});
