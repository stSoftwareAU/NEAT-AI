import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import type { MemeticInterface } from "./MemeticInterface.ts";

export function memeticUpdate(
  parent: Creature,
  child: Creature,
): MemeticInterface | undefined {
  assert(parent.memetic);
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

  const parentExport = parent.exportJSON();

  const weightsMap = new Map<number, Map<number, number>>();

  const foundSet = new Set<string>();
  for (const synapse of parentExport.synapses) {
    let weights = weightsMap.get(synapse.fromId);
    if (weights === undefined) {
      weights = new Map();
      weightsMap.set(synapse.fromId, weights);
    }
    weights.set(synapse.toId, synapse.weight);
    foundSet.add(`${synapse.fromId}-${synapse.toId}`);
  }

  const childExport = child.exportJSON();

  for (const synapse of childExport.synapses) {
    foundSet.delete(`${synapse.fromId}-${synapse.toId}`);

    const fromWeights = weightsMap.get(synapse.fromId);
    if (fromWeights === undefined) {
      return undefined;
    }
    const weight = fromWeights.get(synapse.toId);
    if (weight === undefined) {
      return undefined;
    }
    if (
      synapse.weight !== weight && Math.abs(synapse.weight - weight) > 0.000_001
    ) {
      if (memetic.weights === undefined) {
        memetic.weights = {};
      }
      let fromWeights = memetic.weights[synapse.fromId];
      if (fromWeights === undefined) {
        fromWeights = [];
        memetic.weights[synapse.fromId] = fromWeights;
      }
      const toWeight = fromWeights.find((w) => w.toId === synapse.toId);
      if (toWeight === undefined) {
        memetic.weights[synapse.fromId].push({
          toId: synapse.toId,
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
