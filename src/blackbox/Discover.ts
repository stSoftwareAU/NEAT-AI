import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import type { MemeticInterface } from "./MemeticInterface.ts";

export function discover(mum: Creature, child: Creature) {
  assert(child.memetic === undefined, "Child must NOT have memetic");
  if (mum.score === undefined) return;
  if (child.score !== undefined) return;
  if (mum.neurons.length !== child.neurons.length) return;
  if (mum.synapses.length !== child.synapses.length) return;
  const idSquashMap = new Map<number, string>();
  for (const mumNeuron of mum.neurons) {
    idSquashMap.set(
      mumNeuron.id,
      mumNeuron.squash ? mumNeuron.squash : "OTHER",
    );
  }

  for (const childNeuron of child.neurons) {
    const mumSquash = idSquashMap.get(childNeuron.id);
    if (!mumSquash) {
      return;
    }
    const childSquash = childNeuron.squash ? childNeuron.squash : "OTHER";
    if (mumSquash !== childSquash) {
      return;
    }
  }
  const mumSynapseSet = new Set<string>();
  for (const mumSynapse of mum.synapses) {
    mumSynapseSet.add(
      mum.neurons[mumSynapse.from].id + "->" +
        mum.neurons[mumSynapse.to].id,
    );
  }
  for (const childSynapse of child.synapses) {
    const key = child.neurons[childSynapse.from].id + "->" +
      child.neurons[childSynapse.to].id;
    if (!mumSynapseSet.has(key)) {
      return;
    }
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
      memetic.biases[mumNeuron.id!] = mumNeuron.bias;
    }
  }

  for (let i = mumExport.synapses.length; i--;) {
    const mumSynapse = mumExport.synapses[i];
    const childSynapse = childExport.synapses[i];

    if (mumSynapse.weight !== childSynapse.weight) {
      if (!memetic.weights[mumSynapse.fromId!]) {
        memetic.weights[mumSynapse.fromId!] = [];
      }

      memetic.weights[mumSynapse.fromId!].push({
        toId: mumSynapse.toId!,
        weight: mumSynapse.weight,
      });
    }
  }
  child.memetic = memetic;
}
