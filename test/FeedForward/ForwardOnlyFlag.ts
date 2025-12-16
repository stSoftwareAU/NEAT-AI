import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("forwardOnly flag survives export/import", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  const exported = creature.exportJSON();
  assert(exported.forwardOnly === true);

  const loaded = Creature.fromJSON(exported);
  assertEquals(loaded.forwardOnly, true);
});

Deno.test("Breeding honours forwardOnly flag (child becomes forward-only)", () => {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
  const dadJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      // Extra connection so crossover can create a non-clone child.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const loadedMum = Creature.fromJSON(mumJson);
  const dad = Creature.fromJSON(dadJson);

  // Inject a legacy self connection into mum to simulate older populations.
  const hiddenIndex = loadedMum.input;
  loadedMum.synapses.push(new Synapse(hiddenIndex, hiddenIndex, 0.25));
  loadedMum.synapses.sort((a, b) =>
    a.from === b.from ? a.to - b.to : a.from - b.from
  );

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    child = Offspring.breed(loadedMum, dad, { forwardOnly: true });
    if (child) break;
  }
  assert(child, "Expected child");
  assertEquals(child.forwardOnly, true);

  // Ensure no self/back connections remain.
  child.synapses.forEach((s) => {
    assert(
      s.from < s.to,
      `Expected forward-only synapse, got ${s.from}->${s.to}`,
    );
  });
});

Deno.test("Breeding inherits forwardOnly by default (when a parent is forward-only)", () => {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
  const dadJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      // Extra connection so crossover can create a non-clone child.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const mum = Creature.fromJSON(mumJson);
  const dad = Creature.fromJSON(dadJson);
  let child: Creature | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    child = Offspring.breed(mum, dad);
    if (child) break;
  }
  assert(child, "Expected child");
  assertEquals(child.forwardOnly, true);
  child.validate({ forwardOnly: true });
});

Deno.test("Breeding with forwardOnly=false clears child forwardOnly (keeps memory connections)", () => {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
  const dadJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      // Extra connection so crossover can create a non-clone child.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const mum = Creature.fromJSON(mumJson);
  const dad = Creature.fromJSON(dadJson);

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    child = Offspring.breed(mum, dad, { forwardOnly: false });
    if (child) break;
  }
  assert(child, "Expected child");
  assertEquals(child.forwardOnly, undefined);
  child.validate();
});
