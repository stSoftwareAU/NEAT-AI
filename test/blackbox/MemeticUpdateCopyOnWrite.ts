/**
 * Issue #3091: memeticUpdate must avoid the full JSON deep-clone and instead
 * use a copy-on-write structural clone. These tests pin two guarantees:
 *
 *  1. Equivalence — the returned memetic deep-equals the result of the old
 *     JSON-clone-then-append reference across a range of parent/child diffs.
 *  2. Isolation — mutating the returned memetic (top-level containers and the
 *     per-`fromId` weight arrays it appends to) never mutates `parent.memetic`.
 */
import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { memeticUpdate } from "@blackbox/MemeticUpdate.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";

function baseCreature(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        id: 5001,
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.5,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
    ],
  };
}

/**
 * Reference implementation: the original full JSON deep-clone followed by the
 * same additive merge. Used only to assert equivalence in tests.
 */
function memeticUpdateJsonReference(
  parent: Creature,
  child: Creature,
): MemeticInterface | undefined {
  if (!parent.memetic) return undefined;
  if (parent.neurons.length !== child.neurons.length) return undefined;

  const memetic: MemeticInterface = JSON.parse(JSON.stringify(parent.memetic));

  const squashMap = new Map<number, string>();
  const biasMap = new Map<number, number>();
  for (let i = parent.input; i < parent.neurons.length; i++) {
    const neuron = parent.neurons[i];
    squashMap.set(neuron.id, neuron.squash ?? "NONE");
    biasMap.set(neuron.id, neuron.bias);
  }
  for (let i = child.input; i < child.neurons.length; i++) {
    const neuron = child.neurons[i];
    const squash = squashMap.get(neuron.id);
    if (!squash) return undefined;
    if ((neuron.squash ?? "NONE") !== squash) return undefined;
    if (neuron.bias !== biasMap.get(neuron.id)) {
      if (memetic.biases === undefined) memetic.biases = {};
      if (memetic.biases[neuron.id] === undefined) {
        memetic.biases[neuron.id] = neuron.bias;
      }
    }
  }

  const weightsMap = new Map<number, Map<number, number>>();
  const foundSet = new Set<string>();
  for (const synapse of parent.synapses) {
    const fromId = parent.neurons[synapse.from]?.id;
    const toId = parent.neurons[synapse.to]?.id;
    if (fromId === undefined || toId === undefined) return undefined;
    let weights = weightsMap.get(fromId);
    if (weights === undefined) {
      weights = new Map();
      weightsMap.set(fromId, weights);
    }
    weights.set(toId, synapse.weight);
    foundSet.add(`${fromId}-${toId}`);
  }
  for (const synapse of child.synapses) {
    const fromId = child.neurons[synapse.from]?.id;
    const toId = child.neurons[synapse.to]?.id;
    if (fromId === undefined || toId === undefined) return undefined;
    foundSet.delete(`${fromId}-${toId}`);
    const fromWeights = weightsMap.get(fromId);
    if (fromWeights === undefined) return undefined;
    const weight = fromWeights.get(toId);
    if (weight === undefined) return undefined;
    if (
      synapse.weight !== weight && Math.abs(synapse.weight - weight) > 0.000_001
    ) {
      if (memetic.weights === undefined) memetic.weights = {};
      let fw = memetic.weights[fromId];
      if (fw === undefined) {
        fw = [];
        memetic.weights[fromId] = fw;
      }
      if (fw.find((w) => w.toId === toId) === undefined) {
        memetic.weights[fromId].push({ toId, weight });
      }
    }
  }
  if (foundSet.size > 0) return undefined;
  return memetic;
}

function populatedMemetic(): MemeticInterface {
  return {
    generation: 7,
    score: 0.42,
    biases: { [5001]: 0.31, [9999]: 0.9 },
    weights: {
      [0]: [{ toId: 5001, weight: 0.41 }],
      [1]: [{ toId: 5001, weight: 0.22 }],
      [5001]: [{ toId: 7777, weight: 0.6 }],
    },
    ancestry: [
      {
        generation: 6,
        score: 0.4,
        biases: { [5001]: 0.3 },
        weights: { [0]: [{ toId: 5001, weight: 0.4 }] },
      },
    ],
  };
}

Deno.test("memeticUpdate COW - equals JSON reference across a range of diffs", () => {
  const diffs: Array<(c: CreatureExport) => void> = [
    () => {}, // no diff
    (c) => (c.neurons[0].bias = 0.7), // bias diff
    (c) => (c.synapses[0].weight = 0.95), // weight diff on existing key
    (c) => (c.synapses[2].weight = 0.95), // weight diff on key 5001
    (c) => {
      c.neurons[0].bias = 0.66;
      c.synapses[0].weight = 0.11;
      c.synapses[1].weight = 0.99;
    }, // combined diffs
  ];

  for (const [i, applyDiff] of diffs.entries()) {
    const parent = Creature.fromJSON(baseCreature());
    parent.memetic = populatedMemetic();
    const refParent = Creature.fromJSON(baseCreature());
    refParent.memetic = populatedMemetic();

    const childJSON = baseCreature();
    applyDiff(childJSON);
    const child = Creature.fromJSON(childJSON);
    const refChild = Creature.fromJSON(childJSON);

    const actual = memeticUpdate(parent, child);
    const expected = memeticUpdateJsonReference(refParent, refChild);

    assertEquals(actual, expected, `diff #${i} should match JSON reference`);
  }
});

Deno.test("memeticUpdate COW - mutating result never mutates parent", () => {
  const parent = Creature.fromJSON(baseCreature());
  parent.memetic = populatedMemetic();
  const parentSnapshot = JSON.parse(JSON.stringify(parent.memetic));

  const childJSON = baseCreature();
  childJSON.neurons[0].bias = 0.7; // bias diff
  childJSON.synapses[0].weight = 0.95; // weight diff on key 0
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assert(result, "Should return a MemeticInterface");

  // The mutated weight array must be a distinct object from the parent's.
  assertNotStrictEquals(
    result.weights[0],
    parent.memetic!.weights[0],
    "mutated fromId array must be copied, not aliased",
  );

  // Aggressively mutate the containers the function builds/appends to. The
  // never-modified `ancestry` subtree is intentionally shared by reference
  // (Issue #3091), so it is exercised separately below — not here.
  result.biases[5001] = -999;
  result.biases[12345] = -1;
  result.weights[0].push({ toId: 4242, weight: -7 });
  result.weights[0][0].weight = -7;
  result.weights[42] = [{ toId: 1, weight: 1 }];
  result.generation = -1;
  result.score = -1;

  // Parent's biases/weights/generation/score must be unchanged.
  assertEquals(
    parent.memetic!.biases,
    parentSnapshot.biases,
    "parent biases must be unchanged",
  );
  assertEquals(
    parent.memetic!.weights,
    parentSnapshot.weights,
    "parent weights must be unchanged after mutating the result",
  );
  assertEquals(parent.memetic!.generation, parentSnapshot.generation);
  assertEquals(parent.memetic!.score, parentSnapshot.score);
});

Deno.test("memeticUpdate COW - unmutated weight arrays equal parent values", () => {
  const parent = Creature.fromJSON(baseCreature());
  parent.memetic = populatedMemetic();

  const childJSON = baseCreature();
  childJSON.synapses[0].weight = 0.95; // only key 0 mutated
  const child = Creature.fromJSON(childJSON);

  const result = memeticUpdate(parent, child);
  assert(result, "Should return a MemeticInterface");

  // Untouched keys carry the same values as the parent (COW reuse is fine).
  assertEquals(result.weights[1], parent.memetic!.weights[1]);
  assertEquals(result.weights[5001], parent.memetic!.weights[5001]);
  assertEquals(result.ancestry, parent.memetic!.ancestry);
});
