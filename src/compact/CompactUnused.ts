import { addTag, removeTag } from "@stsoftware/tags";
import { Creature, type CreatureTrace, CreatureUtil } from "../../mod.ts";
import { createConstantOne, removeHiddenNeuron } from "./CompactUtils.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import { assert } from "@std/assert/assert";

export function compactUnused(
  traced: CreatureTrace,
  plankConstant: number,
) {
  const start = Creature.fromJSON(traced);
  const clean = Creature.fromJSON(start.exportJSON());
  const compacted = Creature.fromJSON(clean.exportJSON());

  const neuronScale = new Map<string, number>();
  const synapseCount = new Map<string, number>();
  traced.synapses.forEach((synapse) => {
    let counter: number = synapseCount.get(synapse.toUUID) || 0;
    counter++;
    synapseCount.set(synapse.toUUID, counter);

    let maxScale: number = neuronScale.get(synapse.fromUUID) || 0;
    const scale = Math.abs(synapse.weight);
    if (scale > maxScale) {
      maxScale = scale;
    }
    neuronScale.set(synapse.fromUUID, maxScale);
  });
  const indices = Int32Array.from(
    { length: traced.neurons.length },
    (_, i) => i,
  ); // Create an array of indices

  CreatureUtil.shuffle(indices);

  for (let i = indices.length; i--;) {
    const neuron = traced.neurons[indices[i]];
    if (neuron.type !== "hidden") continue;
    if (neuron.trace && neuron.trace.count >= 1) {
      const counter = synapseCount.get(neuron.uuid);
      assert(counter !== undefined, "Counter should not be undefined");
      const maxScale = neuronScale.get(neuron.uuid);
      assert(maxScale !== undefined, "Max Scale should not be undefined");
      const maxEffect = Math.abs(
        neuron.trace.maximumActivation - neuron.trace.minimumActivation,
      ) * Math.min(maxScale, 1);
      if (
        maxEffect < plankConstant * counter
      ) {
        if (
          removeNeuron(neuron.uuid, compacted, neuron.trace.maximumActivation)
        ) {
          addTag(compacted, "unused", neuron.uuid);
          try {
            creatureValidate(compacted);
          } catch (e) {
            const errorMsg = (e as Error).message;
            console.warn("compactUnused", errorMsg);
            compacted.fix();
          }
          break;
        }
      }
    }
  }
  const cleanUUID = CreatureUtil.makeUUID(clean);
  const compactedUUID = CreatureUtil.makeUUID(compacted);
  if (cleanUUID !== compactedUUID) {
    addTag(compacted, "approach", "compact" as Approach);
    delete compacted.memetic;
    removeTag(compacted, "approach-logged");
    addTag(compacted, "old-neurons", clean.neurons.length.toString());
    addTag(
      compacted,
      "old-synapses",
      clean.synapses.length.toString(),
    );

    return compacted;
  } else {
    return undefined;
  }
}

function removeNeuron(uuid: string, creature: Creature, activation: number) {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  if (neuron?.index) {
    let useConstant = false;
    const fromList = creature.outwardConnections(neuron.index);

    for (const synapse of fromList) {
      const squash = creature.neurons[synapse.to].findSquash();

      const propagateUpdateMethod = squash as NeuronActivationInterface;
      if (propagateUpdateMethod.propagate !== undefined) {
        useConstant = true;

        break;
      }
    }

    if (useConstant) {
      let constantNeuron = createConstantOne(creature, 0);
      for (let count = 1; count < 3; count++) {
        for (const synapse of fromList) {
          if (creature.getSynapse(constantNeuron.index, synapse.to)) {
            constantNeuron = createConstantOne(creature, count);
          } else {
            break;
          }
        }
      }

      for (const synapse of fromList) {
        if (creature.getSynapse(constantNeuron.index, synapse.to)) {
          return false;
        }
      }

      for (const synapse of fromList) {
        creature.connect(
          constantNeuron.index,
          synapse.to,
          synapse.weight * activation,
          synapse.type,
        );
      }
      removeHiddenNeuron(creature, neuron.index);

      return true;
    } else {
      for (const synapse of fromList) {
        const adjustedBias = synapse.weight * activation;
        creature.neurons[synapse.to].bias += adjustedBias;

        const toList = creature.inwardConnections(synapse.to);
        if (toList.length < 2) {
          const randomFromIndx = Math.floor(Math.random() * creature.input);

          /* Add a new connection which will be removed later because weight is zero */
          creature.connect(randomFromIndx, synapse.to, 0);
        }
      }
    }

    removeHiddenNeuron(creature, neuron.index);
    return true;
  }
  return false;
}
