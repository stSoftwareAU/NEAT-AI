import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

Deno.test("forwardOnly flag survives export/import", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;

  const exported = creature.exportJSON();
  assertEquals(exported.forwardOnly, true, "forwardOnly should survive export");

  const loaded = Creature.fromJSON(exported);
  assertEquals(loaded.forwardOnly, true);
});

Deno.test(
  "Breeding forward-only throws when mother has illegal self-connection (#2086)",
  () => {
    const mumJson: CreatureExport = {
      input: 2,
      output: 1,
      semanticVersion: "4.0.0",
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
      semanticVersion: "4.0.0",
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

    // Invalid 4.x parent is rejected in prepareCreatureForBreeding → validateFourX
    // (Issue #2086) before offspring build; that path rethrows ValidationError.
    const err = assertThrows(
      () => Offspring.breed(loadedMum, dad, { forwardOnly: true }),
      ValidationError,
    );
    assertEquals((err as ValidationError).reason, "SELF_CONNECTION");
  },
);

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

Deno.test("Breeding with forwardOnly=false sets child forwardOnly=false when parents are not 4.x", () => {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    semanticVersion: "2.0.0",
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
    semanticVersion: "2.0.0",
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
  assertEquals(child.forwardOnly, false);
  assertEquals(child.semanticVersion, "4.0.0");
  child.validate();
});
