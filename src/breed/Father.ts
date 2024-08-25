import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "../architecture/SynapseInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";

function matchNeuronsBySynapses(
  motherNeuron: NeuronExport,
  fatherNeuron: NeuronExport,
  motherSynapses: SynapseExport[],
  fatherSynapses: SynapseExport[],
): boolean {
  const motherSynapsesTo = motherSynapses.filter((s) =>
    s.toUUID === motherNeuron.uuid
  );
  const fatherSynapsesTo = fatherSynapses.filter((s) =>
    s.toUUID === fatherNeuron.uuid
  );

  if (motherSynapsesTo.length !== fatherSynapsesTo.length) {
    return false;
  }

  for (let i = 0; i < motherSynapsesTo.length; i++) {
    const motherSynapse = motherSynapsesTo[i];
    const fatherSynapse = fatherSynapsesTo[i];

    // Compare the structure, not just the UUIDs
    if (motherSynapse.fromUUID !== fatherSynapse.fromUUID) {
      return false;
    }
  }

  return true;
}

export function createCompatibleFather(
  mother: CreatureExport,
  father: CreatureExport,
): CreatureExport {
  const uuidMapping = new Map<string, string>();

  // Step 1: Identify matching neurons by structure and populate the UUID mapping
  mother.neurons.forEach((motherNeuron) => {
    const matchingFatherNeuron = father.neurons.find((fatherNeuron) =>
      matchNeuronsBySynapses(
        motherNeuron,
        fatherNeuron,
        mother.synapses,
        father.synapses,
      )
    );

    if (matchingFatherNeuron) {
      uuidMapping.set(matchingFatherNeuron.uuid, motherNeuron.uuid);
    }
  });

  // Additional Step: Check for any unmapped neurons in the mother that should map to unmapped neurons in the father
  mother.neurons.forEach((motherNeuron) => {
    if (![...uuidMapping.values()].includes(motherNeuron.uuid)) {
      const possibleFatherNeuron = father.neurons.find((fatherNeuron) =>
        !uuidMapping.has(fatherNeuron.uuid) &&
        fatherNeuron.squash === motherNeuron.squash
      );
      if (possibleFatherNeuron) {
        uuidMapping.set(possibleFatherNeuron.uuid, motherNeuron.uuid);
      }
    }
  });

  // Step 2: Apply UUID mappings to neurons
  const newNeurons = father.neurons.map((fatherNeuron) => {
    const newUUID = uuidMapping.get(fatherNeuron.uuid);
    if (newUUID) {
      return {
        ...fatherNeuron,
        uuid: newUUID,
      };
    }
    return fatherNeuron;
  });

  // Step 3: Apply UUID mappings to synapses
  const newSynapses = father.synapses.map((synapse) => {
    const updatedFromUUID = uuidMapping.get(synapse.fromUUID) ||
      synapse.fromUUID;
    const updatedToUUID = uuidMapping.get(synapse.toUUID) || synapse.toUUID;
    return {
      ...synapse,
      fromUUID: updatedFromUUID,
      toUUID: updatedToUUID,
    };
  });

  // Step 4: Return the updated father creature
  const adjustedFather: CreatureExport = {
    ...father,
    neurons: newNeurons,
    synapses: newSynapses,
  };

  return adjustedFather;
}
