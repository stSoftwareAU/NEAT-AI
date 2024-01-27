import { addTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature, CreatureTrace, CreatureUtil } from "../../mod.ts";
import { PLANK_CONSTANT } from "../architecture/BackPropagation.ts";
import { removeHiddenNode } from "./CompactUtils.ts";

export async function compactUnused(traced: CreatureTrace) {
  const start = Creature.fromJSON(traced);
  const clean = Creature.fromJSON(start.exportJSON());
  const compacted = Creature.fromJSON(clean.exportJSON());

  for (const neuron of traced.neurons) {
    if (neuron.type !== "hidden") continue;
    if (neuron.trace.count > 1) {
      if (
        Math.abs(
          neuron.trace.maximumActivation - neuron.trace.minimumActivation,
        ) < PLANK_CONSTANT
      ) {
        addTag(compacted, "unused", neuron.uuid);

        removeNeuron(neuron.uuid, compacted, neuron.trace.maximumActivation);
        break;
      }
    }
  }
  const cleanUUID = await CreatureUtil.makeUUID(clean);
  const compactedUUID = await CreatureUtil.makeUUID(compacted);
  if (cleanUUID !== compactedUUID) {
    addTag(compacted, "approach", "compact");
    addTag(compacted, "old-nodes", clean.neurons.length.toString());
    addTag(
      compacted,
      "old-connections",
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
    const fromList = creature.fromConnections(neuron.index);

    for (const synapse of fromList) {
      const adjustedBias = synapse.weight * activation;
      creature.neurons[synapse.to].bias += adjustedBias;

      const toList = creature.toConnections(synapse.to);
      if (toList.length < 2) {
        const randomFromIndx = Math.floor(Math.random() * creature.input);
        creature.connect(randomFromIndx, synapse.to, 0);
      }
    }

    removeHiddenNode(creature, neuron.index);
  }
}
