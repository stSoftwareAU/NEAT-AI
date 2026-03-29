import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { pruneOrphanMemeticReferences } from "@compact/MemeticCleanup.ts";
import { fix } from "@creature/CreatureMutation.ts";

Deno.test("pruneOrphanMemeticReferences removes stale bias keys", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-a",
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
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json, true);
  const hiddenId = creature.neurons[creature.input].id;

  creature.memetic = {
    generation: 1,
    score: 0,
    biases: {
      [hiddenId]: 0.1,
      1_998_066_541: 0.5,
    },
    weights: {},
  };

  // creatureValidate now silently prunes stale memetic entries rather than
  // throwing, so we verify that pruneOrphanMemeticReferences also handles
  // the cleanup correctly on a fresh creature with stale data.
  const staleBefore = creature.memetic?.biases[1_998_066_541];
  assert(
    staleBefore !== undefined,
    "stale bias key should exist before prune",
  );

  pruneOrphanMemeticReferences(creature);
  creatureValidate(creature);
  assert(
    creature.memetic?.biases[1_998_066_541] === undefined,
    "stale bias key should be removed",
  );
  assertEquals(creature.memetic?.biases[hiddenId], 0.1);
});

Deno.test("fix() leaves memetic consistent for validate after stale memetic", () => {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden" as const,
        uuid: "hidden-a",
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
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json, true);
  creature.memetic = {
    generation: 1,
    score: 0,
    biases: { 1_998_066_541: 0.5 },
    weights: {},
  };

  fix(creature, { forwardOnly: true });
  creatureValidate(creature, { forwardOnly: true });
});
