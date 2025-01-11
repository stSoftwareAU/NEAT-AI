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

  const neuronToRemove = exported.neurons.find(
    (neuron: NeuronExport) => neuron.uuid === identityUUID,
  );
  if (!neuronToRemove) {
    throw new Error(`Neuron not found: ${identityUUID}`);
  }

  exported.neurons = exported.neurons.filter(
    (neuron: NeuronExport) => neuron.uuid !== identityUUID,
  );

  const newSynapses: SynapseExport[] = [];
  const adjustedBiases = new Set<string>();

  exported.synapses.forEach((outterSynapse) => {
    if (outterSynapse.toUUID === identityUUID) {
      exported.synapses.forEach((innerSynapse) => {
        if (innerSynapse.fromUUID === identityUUID) {
          const adjustedWeight = outterSynapse.weight * innerSynapse.weight;

          const duplicate = newSynapses.find(
            (s) =>
              s.fromUUID === outterSynapse.fromUUID &&
              s.toUUID === innerSynapse.toUUID,
          );
          if (!duplicate) {
            newSynapses.push({
              weight: adjustedWeight,
              fromUUID: outterSynapse.fromUUID,
              toUUID: innerSynapse.toUUID,
            });
          }

          const targetNeuron = neuronMap.get(innerSynapse.toUUID);
          if (targetNeuron && !adjustedBiases.has(innerSynapse.toUUID)) {
            // Adjust the bias correctly
            targetNeuron.bias += outterSynapse.weight * neuronToRemove.bias;
            adjustedBiases.add(innerSynapse.toUUID);
          }
        }
      });
    }
  });

  exported.synapses = exported.synapses.filter(
    (synapse) =>
      synapse.toUUID !== identityUUID && synapse.fromUUID !== identityUUID,
  );

  exported.synapses = exported.synapses.concat(newSynapses);

  neuronMap.forEach((neuron) => {
    neuron.bias = parseFloat(neuron.bias.toFixed(10));
  });
  newSynapses.forEach((synapse) => {
    synapse.weight = parseFloat(synapse.weight.toFixed(10));
  });

  console.info(
    "Simplified Creature Export:",
    JSON.stringify(exported, null, 2),
  );

  const simplifiedCreature = Creature.fromJSON(exported);
  simplifiedCreature.validate();
  return simplifiedCreature;
}
