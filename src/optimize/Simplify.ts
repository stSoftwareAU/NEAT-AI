import { addTag, removeTag } from "@stsoftware/tags";
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
  const simpliedExport: CreatureExport = JSON.parse(JSON.stringify(exported));
  const neuronMap = new Map<string, NeuronExport>();
  simpliedExport.neurons.forEach((neuron: NeuronExport) => {
    neuronMap.set(neuron.uuid, neuron);
  });

  const neuronToRemove = simpliedExport.neurons.find(
    (neuron: NeuronExport) => neuron.uuid === identityUUID,
  );
  if (!neuronToRemove) {
    throw new Error(`Neuron not found: ${identityUUID}`);
  }

  simpliedExport.neurons = simpliedExport.neurons.filter(
    (neuron: NeuronExport) => neuron.uuid !== identityUUID,
  );

  const newSynapses: SynapseExport[] = [];
  const adjustedBiases = new Set<string>();

  const synapseMap = new Map<string, Map<string, SynapseExport>>();
  simpliedExport.synapses.forEach((synapse) => {
    let fromMap = synapseMap.get(synapse.fromUUID);
    if (!fromMap) {
      fromMap = new Map<string, SynapseExport>();
      synapseMap.set(synapse.fromUUID, fromMap);
    }
    fromMap.set(synapse.toUUID, synapse);
  });

  simpliedExport.synapses.forEach((outerSynapse) => {
    if (outerSynapse.toUUID === identityUUID) {
      simpliedExport.synapses.forEach((innerSynapse) => {
        if (innerSynapse.fromUUID === identityUUID) {
          const adjustedWeight = outerSynapse.weight * innerSynapse.weight;

          const duplicate = synapseMap.get(outerSynapse.fromUUID)?.get(
            innerSynapse.toUUID,
          );

          if (!duplicate) {
            newSynapses.push({
              weight: adjustedWeight,
              fromUUID: outerSynapse.fromUUID,
              toUUID: innerSynapse.toUUID,
            });
          } else {
            duplicate.weight = adjustedWeight + duplicate.weight;
          }

          const targetNeuron = neuronMap.get(innerSynapse.toUUID);
          if (targetNeuron && !adjustedBiases.has(innerSynapse.toUUID)) {
            // Adjust bias using the weight sign
            const biasAdjustment = neuronToRemove.bias * innerSynapse.weight;
            const bias = targetNeuron!.bias + biasAdjustment;
            targetNeuron!.bias = bias;
            adjustedBiases.add(innerSynapse.toUUID);
          }
        }
      });
    }
  });

  simpliedExport.synapses = simpliedExport.synapses.filter(
    (synapse) =>
      synapse.toUUID !== identityUUID && synapse.fromUUID !== identityUUID,
  );

  simpliedExport.synapses = simpliedExport.synapses.concat(newSynapses);

  delete simpliedExport.memetic;
  const simplifiedCreature = Creature.fromJSON(simpliedExport);
  addTag(simplifiedCreature, "approach", "simplified");

  removeTag(simplifiedCreature, "approach-logged");

  simplifiedCreature.validate();
  return simplifiedCreature;
}
