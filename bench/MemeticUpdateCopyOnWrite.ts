/**
 * Benchmark for Issue #3091: avoid the full JSON deep-clone in memeticUpdate.
 *
 * memeticUpdate runs per-offspring during breeding (Offspring.ts) and
 * per-mutation on the revert path (Mutator.ts) — i.e. O(children × generations).
 * The old implementation deep-cloned the parent's entire memetic graph via
 * `JSON.parse(JSON.stringify(...))` and then appended only the handful of
 * changed bias/weight entries. For a populated memetic the round-trip dominates
 * the additive merge it precedes.
 *
 * This bench compares the old JSON-clone-then-append (baseline) against the new
 * copy-on-write structural clone (current `memeticUpdate`) over a creature with
 * a populated memetic and a small diff.
 *
 * Run with:
 *   deno bench --allow-all bench/MemeticUpdateCopyOnWrite.ts
 */
import { Creature, type CreatureExport } from "../mod.ts";
import { memeticUpdate } from "@blackbox/MemeticUpdate.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";

// Build a parent/child pair with a densely-populated memetic and a small diff.
function buildPair(hidden: number): { parent: Creature; child: Creature } {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  for (let h = 0; h < hidden; h++) {
    neurons.push({
      type: "hidden",
      id: 10_000 + h,
      uuid: `hidden-${h}`,
      squash: "LOGISTIC",
      bias: 0.1 + h * 0.001,
    });
    // Each hidden neuron is fed by both inputs and feeds the output.
    synapses.push(
      { fromUUID: "input-0", toUUID: `hidden-${h}`, weight: 0.2 + h * 0.0001 },
      { fromUUID: "input-1", toUUID: `hidden-${h}`, weight: 0.3 + h * 0.0001 },
      { fromUUID: `hidden-${h}`, toUUID: "output-0", weight: 0.4 + h * 0.0001 },
    );
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0.05,
  });

  const exportJSON: CreatureExport = { input: 2, output: 1, neurons, synapses };

  const parent = Creature.fromJSON(exportJSON);

  // Populate a large memetic graph: biases for every neuron + per-fromId
  // weight arrays (several entries each) for every source neuron, plus a few
  // generations of ancestry snapshots. This mirrors a memetic that has
  // accumulated many tracked changes — exactly what the old JSON round-trip
  // had to serialise/parse in full.
  const buildBiases = (): MemeticInterface["biases"] => {
    const b: MemeticInterface["biases"] = {};
    for (let h = 0; h < hidden; h++) b[10_000 + h] = 0.1 + h * 0.001;
    return b;
  };
  const buildWeights = (): MemeticInterface["weights"] => {
    const w: MemeticInterface["weights"] = {};
    for (let h = 0; h < hidden; h++) {
      const arr = [];
      for (let k = 0; k < 8; k++) {
        arr.push({ toId: 20_000 + k, weight: 0.4 + h * 0.0001 + k * 0.01 });
      }
      w[10_000 + h] = arr;
    }
    return w;
  };
  const ancestry: NonNullable<MemeticInterface["ancestry"]> = [];
  for (let g = 0; g < 3; g++) {
    ancestry.push({
      generation: 4 - g,
      score: 0.5 - g * 0.01,
      biases: buildBiases(),
      weights: buildWeights(),
    });
  }
  parent.memetic = {
    generation: 5,
    score: 0.6,
    biases: buildBiases(),
    weights: buildWeights(),
    ancestry,
  };

  // Child carries a single changed bias so the merge appends exactly one entry.
  const childJSON: CreatureExport = JSON.parse(JSON.stringify(exportJSON));
  childJSON.neurons[0].bias = 0.999;
  const child = Creature.fromJSON(childJSON);

  return { parent, child };
}

/** Old implementation: full JSON deep-clone then additive merge. */
function memeticUpdateJsonClone(
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
    let w = weightsMap.get(fromId);
    if (w === undefined) {
      w = new Map();
      weightsMap.set(fromId, w);
    }
    w.set(toId, synapse.weight);
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
      if (fw.find((x) => x.toId === toId) === undefined) {
        memetic.weights[fromId].push({ toId, weight });
      }
    }
  }
  if (foundSet.size > 0) return undefined;
  return memetic;
}

for (const hidden of [50, 200, 800]) {
  const { parent, child } = buildPair(hidden);
  const group = `memeticUpdate (${hidden} hidden neurons)`;

  Deno.bench({
    name: "JSON deep-clone (baseline)",
    group,
    baseline: true,
    fn: () => {
      memeticUpdateJsonClone(parent, child);
    },
  });

  Deno.bench({
    name: "copy-on-write (Issue #3091)",
    group,
    fn: () => {
      memeticUpdate(parent, child);
    },
  });
}
