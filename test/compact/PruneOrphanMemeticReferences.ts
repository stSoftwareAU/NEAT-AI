import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  type MemeticPruneTarget,
  pruneOrphanMemeticReferences,
} from "@compact/MemeticCleanup.ts";
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

  let threw = false;
  try {
    creatureValidate(creature);
  } catch {
    threw = true;
  }
  assert(
    threw,
    "validate should fail before prune with orphan memetic bias key",
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

Deno.test("pruneOrphanMemeticReferences returns the exact count of removed items", () => {
  const memetic = {
    generation: 1,
    score: 0,
    biases: { 0: 0.1, 1: 0.2, 99: 0.5 },
    weights: {
      0: [
        { toId: 1, weight: 0.3 },
        { toId: 2, weight: 0.4 },
      ],
      1: [{ toId: 2, weight: 0.5 }],
      42: [
        { toId: 1, weight: 0.6 },
        { toId: 2, weight: 0.7 },
      ],
    },
    ancestry: [
      {
        generation: 0,
        score: 0,
        biases: {},
        weights: {
          0: [
            { toId: 1, weight: 0.1 },
            { toId: 9, weight: 0.2 },
          ],
        },
      },
    ],
  };
  const target: MemeticPruneTarget = {
    neurons: [{ id: 0 }, { id: 1 }, { id: 2 }],
    synapses: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
    memetic,
  };

  // Bias key 99, the row 0->2 (no synapse), the whole entry for missing source
  // 42 (counted once despite two rows), and the ancestry row to missing 9.
  assertEquals(pruneOrphanMemeticReferences(target), 4);

  assertEquals<unknown>(memetic.biases, { 0: 0.1, 1: 0.2 });
  assertEquals<unknown>(memetic.weights, {
    0: [{ toId: 1, weight: 0.3 }],
    1: [{ toId: 2, weight: 0.5 }],
  });
  assertEquals(memetic.ancestry[0].weights, { 0: [{ toId: 1, weight: 0.1 }] });

  const clean: MemeticPruneTarget = {
    neurons: [{ id: 0 }, { id: 1 }],
    synapses: [{ from: 0, to: 1 }],
    memetic: {
      generation: 1,
      score: 0,
      biases: { 0: 0.1, 1: 0.2 },
      weights: { 0: [{ toId: 1, weight: 0.3 }] },
    },
  };
  assertEquals(pruneOrphanMemeticReferences(clean), 0);
});

Deno.test("pruneOrphanMemeticReferences leaves array-shaped root weights untouched", () => {
  // Wire-shaped weights. Array indices 0-2 are not valid neuron ids (10-12), so
  // deleting by index would carve holes into the array.
  const weights = [
    { fromUUID: "input-0", toUUID: "input-1", weight: 0.3 },
    { fromUUID: "input-1", toUUID: "output-0", weight: 0.4 },
    { fromUUID: "output-0", toUUID: "input-0", weight: 0.5 },
  ];
  const before = structuredClone(weights);
  const memetic = {
    generation: 1,
    score: 0,
    biases: { 10: 0.1, 99: 0.5 },
    weights: weights as unknown as NonNullable<
      MemeticPruneTarget["memetic"]
    >["weights"],
  };
  const target: MemeticPruneTarget = {
    neurons: [{ id: 10 }, { id: 11 }, { id: 12 }],
    synapses: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
    memetic,
  };

  assertEquals(pruneOrphanMemeticReferences(target), 1);

  assertEquals(weights.length, 3);
  assertEquals(Object.keys(weights).length, 3, "no slots deleted");
  assertEquals(weights, before);
  assertEquals<unknown>(memetic.biases, { 10: 0.1 });
});

Deno.test("pruneOrphanMemeticReferences counts nothing for a creature with no memetic", () => {
  const target: MemeticPruneTarget = {
    neurons: [{ id: 0 }, { id: 1 }],
    synapses: [{ from: 0, to: 1 }],
  };
  assertEquals(pruneOrphanMemeticReferences(target), 0);
  assertEquals(target.memetic, undefined);
});

Deno.test("pruneOrphanMemeticReferences prunes biases of a snapshot that has no weights", () => {
  const memetic = {
    generation: 1,
    score: 0,
    biases: { 0: 0.1, 99: 0.5 },
    ancestry: [{ generation: 0, score: 0, biases: { 0: 0.1, 98: 0.2 } }],
  } as unknown as NonNullable<MemeticPruneTarget["memetic"]>;
  const target: MemeticPruneTarget = {
    neurons: [{ id: 0 }, { id: 1 }],
    synapses: [{ from: 0, to: 1 }],
    memetic,
  };

  assertEquals(pruneOrphanMemeticReferences(target), 2);

  assertEquals<unknown>(memetic.biases, { 0: 0.1 });
  assertEquals<unknown>(memetic.ancestry?.[0].biases, { 0: 0.1 });
  assertEquals("weights" in memetic, false, "no weights added");
});
