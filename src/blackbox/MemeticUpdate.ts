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

  const squashMap = new Map<string, string>();
  const biasMap = new Map<string, number>();

  for (let i = parent.input; i < parent.neurons.length; i++) {
    const neuron = parent.neurons[i];
    squashMap.set(neuron.uuid, neuron.squash ?? "NONE");
    biasMap.set(neuron.uuid, neuron.bias);
  }

  for (let i = parent.input; i < parent.neurons.length; i++) {
    const neuron = parent.neurons[i];
    squashMap.set(neuron.uuid, neuron.squash ?? "NONE");
    biasMap.set(neuron.uuid, neuron.bias);
  }

  for (let i = child.input; i < child.neurons.length; i++) {
    const neuron = child.neurons[i];
    const squash = squashMap.get(neuron.uuid);
    if (!squash) {
      return undefined;
    }
    const childSquash = neuron.squash ?? "NONE";
    if (childSquash !== squash) {
      return undefined;
    }
    const parentBias = biasMap.get(neuron.uuid);
    if (neuron.bias !== parentBias) {
      if (memetic.biases === undefined) {
        memetic.biases = {};
      }
      if (memetic.biases[neuron.uuid] === undefined) {
        memetic.biases[neuron.uuid] = neuron.bias;
      }
    }
  }

  const parentExport = parent.exportJSON();

  const weightsMap = new Map<string, Map<string, number>>();

  const foundSet = new Set<string>();
  for (let i = 0; i < parentExport.synapses.length; i++) {
    const synapse = parentExport.synapses[i];
    let weights = weightsMap.get(synapse.fromUUID);
    if (weights === undefined) {
      weights = new Map();
      weightsMap.set(synapse.fromUUID, weights);
    }
    weights.set(synapse.toUUID, synapse.weight);
    foundSet.add(`${synapse.fromUUID}-${synapse.toUUID}`);
  }

  const childExport = child.exportJSON();

  for (let i = 0; i < childExport.synapses.length; i++) {
    const synapse = childExport.synapses[i];
    foundSet.delete(`${synapse.fromUUID}-${synapse.toUUID}`);

    const fromWeights = weightsMap.get(synapse.fromUUID);
    if (fromWeights === undefined) {
      return undefined;
    }
    const weight = fromWeights.get(synapse.toUUID);
    if (weight === undefined) {
      return undefined;
    }
    if (
      synapse.weight !== weight && Math.abs(synapse.weight - weight) > 0.000_001
    ) {
      if (memetic.weights === undefined) {
        memetic.weights = {};
      }
      let fromWeights = memetic.weights[synapse.fromUUID];
      if (fromWeights === undefined) {
        fromWeights = [];
        memetic.weights[synapse.fromUUID] = fromWeights;
      }
      const toWeight = fromWeights.find((w) => w.toUUID === synapse.toUUID);
      if (toWeight === undefined) {
        memetic.weights[synapse.fromUUID].push({
          toUUID: synapse.toUUID,
          weight: weight,
        });
      }
    }

    foundSet.delete(`${synapse.fromUUID}-${synapse.toUUID}`);
  }

  if (foundSet.size > 0) {
    return undefined;
  }

  return memetic;
}
