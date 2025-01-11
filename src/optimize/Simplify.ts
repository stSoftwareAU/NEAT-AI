import { type CreatureExport, CreatureUtil } from "../../mod.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import { Creature } from "../Creature.ts";
import { IDENTITY } from "../methods/activations/types/IDENTITY.ts";

export function simplify(creature: Creature): Creature | undefined {
  const complexUUID = CreatureUtil.makeUUID(creature);
  const exported = creature.exportJSON();
  const identityUUIDs: string[] = [];
  exported.neurons.forEach((neuron) => {
    if (neuron.squash === IDENTITY.NAME && neuron.type === "hidden") {
      identityUUIDs.push(neuron.uuid);
    }
  });
  if (identityUUIDs.length !== 0) {
    return removeIDENTITY(
      exported,
      identityUUIDs[Math.floor(Math.random() * identityUUIDs.length)],
    );
  }
  const simplifiedCreature = Creature.fromJSON(exported);
  const simplifiedUUID = CreatureUtil.makeUUID(simplifiedCreature);
  if (complexUUID === simplifiedUUID) {
    return undefined;
  }
  return simplifiedCreature;
}

export function removeIDENTITY(
  exported: CreatureExport,
  identityUUID: string,
): Creature {
  const neuronMap = new Map<string, NeuronExport>();
  exported.neurons.forEach((neuron: NeuronExport) => {
    neuronMap.set(neuron.uuid, neuron);
  });
  // Remove the identity neuron and all synapses to it
  const neuronToRemove = exported.neurons.find((neuron: NeuronExport) =>
    neuron.uuid === identityUUID
  );
  if (!neuronToRemove) {
    throw new Error(`Neuron not found: ${identityUUID}`);
  }

  exported.neurons = exported.neurons.filter((neuron: NeuronExport) =>
    neuron.uuid !== identityUUID
  );

  const newSynapses: SynapseExport[] = [];
  exported.synapses.forEach((outterSynapse: SynapseExport) => {
    if (outterSynapse.toUUID === identityUUID) {
      exported.synapses.forEach((innerSynapse: SynapseExport) => {
        if (innerSynapse.fromUUID === identityUUID) {
          const w = outterSynapse.weight * innerSynapse.weight;
          const adjustedSynapse = {
            weight: w,
            toUUID: innerSynapse.toUUID,
            fromUUID: outterSynapse.fromUUID,
          };
          newSynapses.push(adjustedSynapse);

          neuronMap.get(innerSynapse.toUUID)!.bias += innerSynapse.weight *
            neuronToRemove.bias;
        }
      });
    }
  });

  exported.synapses = exported.synapses.filter((synapse: SynapseExport) =>
    synapse.toUUID !== identityUUID
  );

  exported.synapses = exported.synapses.filter((synapse: SynapseExport) =>
    synapse.fromUUID !== identityUUID
  );
  exported.synapses = exported.synapses.concat(newSynapses);
  console.info(JSON.stringify(exported, null, 1));
  const simplifiedCreature = Creature.fromJSON(exported);
  simplifiedCreature.validate();
  return simplifiedCreature;
}
