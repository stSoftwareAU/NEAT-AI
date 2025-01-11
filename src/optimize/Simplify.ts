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

  // Find the neuron to remove and validate its existence
  const neuronToRemove = exported.neurons.find(
    (neuron: NeuronExport) => neuron.uuid === identityUUID,
  );
  if (!neuronToRemove) {
    throw new Error(`Neuron not found: ${identityUUID}`);
  }

  // Remove the identity neuron from the list of neurons
  exported.neurons = exported.neurons.filter(
    (neuron: NeuronExport) => neuron.uuid !== identityUUID,
  );

  const newSynapses: SynapseExport[] = [];

  // Adjust synapses involving the removed neuron
  exported.synapses.forEach((outterSynapse: SynapseExport) => {
    if (outterSynapse.toUUID === identityUUID) {
      exported.synapses.forEach((innerSynapse: SynapseExport) => {
        if (innerSynapse.fromUUID === identityUUID) {
          const adjustedWeight = outterSynapse.weight * innerSynapse.weight;

          // Avoid creating duplicate synapses
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

          // Adjust bias of the target neuron
          const targetNeuron = neuronMap.get(innerSynapse.toUUID);
          if (targetNeuron) {
            targetNeuron.bias += innerSynapse.weight * neuronToRemove.bias;
          }
        }
      });
    }
  });

  // Remove all synapses connected to the identity neuron
  exported.synapses = exported.synapses.filter(
    (synapse: SynapseExport) =>
      synapse.toUUID !== identityUUID && synapse.fromUUID !== identityUUID,
  );

  // Add the adjusted synapses
  exported.synapses = exported.synapses.concat(newSynapses);

  // Normalize weights and biases to minimize precision issues
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

  // Create a new creature from the simplified export and validate
  const simplifiedCreature = Creature.fromJSON(exported);
  simplifiedCreature.validate();
  return simplifiedCreature;
}
