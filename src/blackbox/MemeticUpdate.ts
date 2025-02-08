import { assert } from "@std/assert/assert";
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

  return memetic;
}
