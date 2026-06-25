/**
 * Propagates a parent's memetic (local fine-tuning) record onto a child during
 * breeding.
 *
 * `memeticUpdate` returns a new memetic record for a child whose topology
 * matches its parent, copying the parent's bias and weight deltas and appending
 * any changes the child introduced. It uses a copy-on-write strategy (Issue
 * #3091) to avoid a full deep clone on the per-offspring hot path, and returns
 * `undefined` when the structures diverge so the caller falls back to
 * `discover`.
 *
 * @module
 */
import type { Creature } from "../../mod.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";

export function memeticUpdate(
  parent: Creature,
  child: Creature,
): MemeticInterface | undefined {
  // Guard: if the parent has no memetic there is nothing to propagate.
  // This can happen when a creature has a score but was never fine-tuned
  // (e.g. CRISPR-injected creatures that inherit the fittest score but have
  // their memetic explicitly cleared in cleaveDNA). Return undefined so the
  // caller falls back to discover().
  if (!parent.memetic) return undefined;
  if (parent.neurons.length !== child.neurons.length) {
    return undefined;
  }

  // Issue #3091: avoid a full JSON deep-clone of the entire memetic graph.
  // memeticUpdate runs per-offspring during breeding (O(children ×
  // generations)) yet only appends the handful of changed bias/weight entries.
  // Instead of serialising/parsing the whole graph we shallow-copy the
  // top-level object — carrying `generation`, `score` and the never-touched
  // `ancestry` subtree by reference — and clone only the small containers we
  // append to. `biases` is shallow-copied (values are primitives). `weights`
  // uses copy-on-write: each per-`fromId` array is reused from the parent by
  // reference until the first time we mutate that key, at which point we copy
  // just that single array. The result never aliases `parent.memetic`'s arrays
  // for any key it mutates.
  const parentMemetic = parent.memetic;
  const memetic: MemeticInterface = {
    ...parentMemetic,
    biases: parentMemetic.biases
      ? { ...parentMemetic.biases }
      : parentMemetic.biases,
    weights: parentMemetic.weights
      ? { ...parentMemetic.weights }
      : parentMemetic.weights,
  };

  // Tracks `fromId` weight arrays already copied for this call so the
  // copy-on-write clone happens at most once per key.
  const copiedWeightKeys = new Set<number>();

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
    if (!squash) {
      return undefined;
    }
    const childSquash = neuron.squash ?? "NONE";
    if (childSquash !== squash) {
      return undefined;
    }
    const parentBias = biasMap.get(neuron.id);
    if (neuron.bias !== parentBias) {
      if (memetic.biases === undefined) {
        memetic.biases = {};
      }
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
    if (fromId === undefined || toId === undefined) {
      return undefined;
    }

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
    if (fromId === undefined || toId === undefined) {
      return undefined;
    }

    foundSet.delete(`${fromId}-${toId}`);

    const fromWeights = weightsMap.get(fromId);
    if (fromWeights === undefined) {
      return undefined;
    }
    const weight = fromWeights.get(toId);
    if (weight === undefined) {
      return undefined;
    }
    if (
      synapse.weight !== weight && Math.abs(synapse.weight - weight) > 0.000_001
    ) {
      if (memetic.weights === undefined) {
        memetic.weights = {};
      }
      let fromWeights = memetic.weights[fromId];
      if (fromWeights === undefined) {
        fromWeights = [];
        memetic.weights[fromId] = fromWeights;
        copiedWeightKeys.add(fromId);
      } else if (!copiedWeightKeys.has(fromId)) {
        // Copy-on-write: this array is still the parent's. Clone it (and its
        // entries) before mutating so we never alias `parent.memetic`.
        fromWeights = fromWeights.map((e) => ({ ...e }));
        memetic.weights[fromId] = fromWeights;
        copiedWeightKeys.add(fromId);
      }
      const toWeight = fromWeights.find((w) => w.toId === toId);
      if (toWeight === undefined) {
        fromWeights.push({
          toId,
          weight: weight,
        });
      }
    }
  }

  if (foundSet.size > 0) {
    return undefined;
  }

  return memetic;
}
