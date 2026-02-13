import { assert } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureTrace, CreatureUtil } from "../../mod.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { getLogger } from "../utils/Logger.ts";
import type { NeuronTrace } from "../architecture/NeuronInterfaces.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { Approach } from "../NEAT/LogApproach.ts";
import { createConstantOne, removeHiddenNeuron } from "./CompactUtils.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

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

  let neuronForRemoval: NeuronTrace | undefined;
  let smallestEffect: number = Number.MAX_VALUE;

  for (let i = indices.length; i--;) {
    const neuron = traced.neurons[indices[i]];
    if (neuron.type !== "hidden") continue;
    if (neuron.trace && neuron.trace.count >= 1) {
      const counter = synapseCount.get(neuron.uuid);
      assert(counter !== undefined, "Counter should not be undefined");
      const maxScale = neuronScale.get(neuron.uuid);
      assert(maxScale !== undefined, "Max Scale should not be undefined");

      const neuronEffect = Math.abs(
            neuron.trace.maximumActivation - neuron.trace.minimumActivation,
          ) * Math.min(maxScale, 1) - (plankConstant * counter);

      if (neuronEffect < smallestEffect) {
        neuronForRemoval = neuron;
        smallestEffect = neuronEffect;
        if (neuronEffect < 0) { // Lets stop early if we find a neuron that is not used at all
          break;
        }
      }
    }
  }

  if (
    neuronForRemoval
  ) {
    let averageActivation = (neuronForRemoval.trace.maximumActivation +
      neuronForRemoval.trace.minimumActivation) / 2;
    if (
      neuronForRemoval.trace.count > 1 &&
      neuronForRemoval.trace.totalActivation !== undefined &&
      Number.isFinite(neuronForRemoval.trace.totalActivation)
    ) {
      averageActivation = neuronForRemoval.trace.totalActivation /
        neuronForRemoval.trace.count;
    }

    if (
      removeNeuron(
        neuronForRemoval.uuid,
        compacted,
        averageActivation,
      )
    ) {
      addTag(compacted, "unused", neuronForRemoval.uuid);
      try {
        creatureValidate(compacted);
      } catch (e) {
        const errorMsg = (e as Error).message;
        getLogger().warn("compactUnused", errorMsg);
        compacted.fix();
      }
    }
  }

  const cleanUUID = CreatureUtil.makeUUID(clean);
  const compactedUUID = CreatureUtil.makeUUID(compacted);
  if (cleanUUID !== compactedUUID) {
    addTag(compacted, "approach", "compact" as Approach);
    delete compacted.memetic;
    removeTag(compacted, "approach-logged");

    /** Creature DOES have inputs, so we need to subtract them. */
    const oldNeurons = clean.neurons.length - clean.input - clean.output;
    addTag(compacted, "old-neurons", oldNeurons.toString());
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

export function removeNeuron(
  uuid: string,
  creature: Creature,
  activation: number,
) {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron !== undefined, "Neuron should not be undefined");

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
      const connection = creature.getSynapse(constantNeuron.index, synapse.to);
      if (connection) {
        getLogger().info(
          `compactUnused: ${neuron.uuid} already connected to ${constantNeuron.uuid}`,
        );
        if (!synapse.type || !connection.type) {
          let weight = connection.weight;
          weight += synapse.weight * activation;
          if (Number.isFinite(weight)) {
            synapse.weight = weight;
            if (connection.type) {
              synapse.type = connection.type;
            }
          } else {
            getLogger().warn(
              `compactUnused: ${neuron.uuid} already connected to ${constantNeuron.uuid} with weight ${connection.weight} required ${synapse.weight}`,
            );
            return false;
          }
        } else {
          getLogger().warn(
            `compactUnused: ${neuron.uuid} already connected to ${constantNeuron.uuid} with type ${connection.type} required ${connection.type}`,
          );
          return false;
        }
      }
    }

    for (const synapse of fromList) {
      const connection = creature.getSynapse(
        constantNeuron.index,
        synapse.to,
      );
      if (connection) {
        getLogger().info(
          `compactUnused: ${neuron.uuid} already connected to ${constantNeuron.uuid}`,
        );
        if (synapse.type) {
          connection.type = synapse.type;
        }
        connection.weight = synapse.weight;
      } else {
        creature.connect(
          constantNeuron.index,
          synapse.to,
          synapse.weight * activation,
          synapse.type,
        );
      }
    }
    removeHiddenNeuron(creature, neuron.index);

    return true;
  } else {
    // Validate all bias adjustments before applying any, to avoid
    // leaving the creature in a partially corrupted state.
    const adjustments: { toIndex: number; newBias: number }[] = [];
    for (const synapse of fromList) {
      const adjustedBias = synapse.weight * activation;
      const newBias = creature.neurons[synapse.to].bias + adjustedBias;
      if (!Number.isFinite(newBias)) {
        return false;
      }
      adjustments.push({ toIndex: synapse.to, newBias });
    }

    // All adjustments are finite — safe to apply
    for (const { toIndex, newBias } of adjustments) {
      creature.neurons[toIndex].bias = newBias;
    }

    for (const synapse of fromList) {
      const toList = creature.inwardConnections(synapse.to);
      if (toList.length < 2) {
        const randomFromIndx = Math.floor(
          getRandomNumberGenerator().random() * creature.input,
        );

        /* Add a new connection which will be removed later because weight is zero */
        creature.connect(randomFromIndx, synapse.to, 0);
      }
    }
  }

  removeHiddenNeuron(creature, neuron.index);
  return true;
}
