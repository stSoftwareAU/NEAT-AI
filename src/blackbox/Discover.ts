import { assert } from "@std/assert/assert";
import type { Creature } from "../../mod.ts";
import type { MemeticInterface } from "./MemeticInterface.ts";

export function discover(mum: Creature, child: Creature) {
  assert(child.memetic === undefined, "Child must NOT have memetic");
  if (mum.score === undefined) return;
  if (child.score !== undefined) return;
  if (mum.neurons.length !== child.neurons.length) return;
  if (mum.synapses.length !== child.synapses.length) return;
  for (let i = 0; i < mum.neurons.length; i++) {
    if (mum.neurons[i].uuid !== child.neurons[i].uuid) {
      return;
    }
    if (mum.neurons[i].squash !== child.neurons[i].squash) {
      return;
    }
  }

  if (mum.memetic) {
    child.memetic = mum.memetic;
    return;
  }
  const memetic: MemeticInterface = {
    generation: 0,
    score: mum.score!,
    biases: {},
    weights: {},
  };

  const mumExport = mum.exportJSON();
  const childExport = child.exportJSON();

  for (let i = mumExport.neurons.length; i--;) {
    const mumNeuron = mumExport.neurons[i];
    const childNeuron = childExport.neurons[i];

    if (mumNeuron.bias !== childNeuron.bias) {
      memetic.biases[mumNeuron.uuid] = mumNeuron.bias;
    }
  }

  for (let i = mumExport.synapses.length; i--;) {
    const mumSynapse = mumExport.synapses[i];
    const childSynapse = childExport.synapses[i];

    if (mumSynapse.weight !== childSynapse.weight) {
      if (!memetic.weights[mumSynapse.fromUUID]) {
        memetic.weights[mumSynapse.fromUUID] = [];
      }

      memetic.weights[mumSynapse.fromUUID].push({
        toUUID: mumSynapse.toUUID,
        weight: mumSynapse.weight,
      });
    }
  }
  child.memetic = memetic;
}
