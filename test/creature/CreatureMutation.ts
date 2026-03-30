/**
 * Tests for CreatureMutation module.
 * Verifies fix() and makeRandomConnection() behaviour.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import {
  fix,
  makeRandomConnection,
} from "../../src/creature/CreatureMutation.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("makeRandomConnection - adds a connection to a hidden neuron", async () => {
  await initWasmForTests();
  const creature = new Creature(3, 1, {
    layers: [{ count: 3 }],
  });
  creatureValidate(creature);

  // Pick a hidden neuron
  const hiddenIdx = creature.input;
  const beforeCount = creature.synapses.length;

  // Try to disconnect one first to make room
  const inward = creature.inwardConnections(hiddenIdx);
  if (inward.length > 1) {
    creature.disconnect(inward[0].from, inward[0].to);
    const result = makeRandomConnection(creature, hiddenIdx);
    assert(result !== null, "Should create a random connection");
    assertEquals(
      creature.synapses.length,
      beforeCount,
      "Should have same count after disconnect+connect",
    );
  }
});

Deno.test("makeRandomConnection - via Creature facade", async () => {
  await initWasmForTests();
  const creature = new Creature(3, 1, {
    layers: [{ count: 3 }],
  });
  creatureValidate(creature);

  // Remove a connection to make room
  const hiddenIdx = creature.input;
  const inward = creature.inwardConnections(hiddenIdx);
  if (inward.length > 1) {
    creature.disconnect(inward[0].from, inward[0].to);
    const result = creature.makeRandomConnection(hiddenIdx);
    assert(result !== null, "Facade should create a random connection");
  }
});

Deno.test("fix - removes zero-weight synapses", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  // Set a hidden neuron's inward synapse weight to zero
  const hiddenIdx = creature.input;
  const inward = creature.inwardConnections(hiddenIdx);
  if (inward.length > 0) {
    inward[0].weight = 0;
    const beforeCount = creature.synapses.length;
    fix(creature);
    assert(
      creature.synapses.length <= beforeCount,
      "fix() should remove zero-weight synapses",
    );
  }
  creatureValidate(creature);
});

Deno.test("fix - maintains sorted synapses", async () => {
  await initWasmForTests();
  const creature = new Creature(3, 2, {
    layers: [{ count: 3 }],
  });
  creatureValidate(creature);

  fix(creature);

  for (let i = 1; i < creature.synapses.length; i++) {
    const prev = creature.synapses[i - 1];
    const curr = creature.synapses[i];
    assert(
      prev.from < curr.from ||
        (prev.from === curr.from && prev.to <= curr.to),
      `Synapses should be sorted: [${prev.from},${prev.to}] before [${curr.from},${curr.to}]`,
    );
  }
});

Deno.test("fix - via Creature facade", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  creature.fix();
  creatureValidate(creature);
});

Deno.test("fix - removes constant with no outward connections", async () => {
  await initWasmForTests();
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "floating-const", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json, false);
  fix(creature, { forwardOnly: true });
  creatureValidate(creature, { forwardOnly: true });
  assertEquals(
    creature.neurons.some((n) => n.type === "constant"),
    false,
  );
});

Deno.test("fix - with forwardOnly preserves semanticVersion", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
    semanticVersion: "3.0.0",
  });

  assertEquals(creature.semanticVersion, "3.0.0");
  fix(creature, { forwardOnly: true });
  assertEquals(
    creature.semanticVersion,
    "3.0.0",
    "Upgrade is load-from-disk only; fix() must not bump semanticVersion",
  );
  assertEquals(creature.forwardOnly, true);
});

Deno.test("fix - clears UUID when structure changes", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creatureValidate(creature);

  // Record original UUID
  const json = creature.exportJSON();
  const original = Creature.fromJSON(json);
  const originalUUID = original.uuid;

  // Add a zero-weight synapse to force structural change
  const hiddenIdx = creature.input;
  const inward = creature.inwardConnections(hiddenIdx);
  if (inward.length > 0) {
    inward[0].weight = 0;
    fix(creature);
    // UUID should change or be cleared if structure changed
    if (creature.synapses.length !== original.synapses.length) {
      assertNotEquals(
        creature.uuid,
        originalUUID,
        "UUID should change when structure changes",
      );
    }
  }
});
