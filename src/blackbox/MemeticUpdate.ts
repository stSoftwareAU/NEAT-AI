import type { Creature } from "../../mod.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";

export function memeticUpdate(
  parent: Creature,
  child: Creature,
): MemeticInterface | undefined {
  // Guard: if the parent has no memetic there is nothing to propagate.
  // Return undefined so callers fall through to discover() instead of crashing.
  if (!parent.memetic) return undefined;
  if (parent.neurons.length !== child.neurons.length) {
    return undefined;
  }

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
      }
      const toWeight = fromWeights.find((w) => w.toId === toId);
      if (toWeight === undefined) {
        memetic.weights[fromId].push({
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
