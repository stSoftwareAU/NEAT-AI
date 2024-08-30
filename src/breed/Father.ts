import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";

function generateNeuronKeyMap(
  creature: CreatureExport,
): Map<string, NeuronExport> {
  const keyMap = new Map<string, NeuronExport>();

  // Sort synapses by fromUUID and toUUID to ensure consistent key generation
  const sortedSynapses = [...creature.synapses].sort((a, b) => {
    if (a.fromUUID < b.fromUUID) return -1;
    if (a.fromUUID > b.fromUUID) return 1;
    if (a.toUUID < b.toUUID) return -1;
    if (a.toUUID > b.toUUID) return 1;
    return 0;
  });

  // Map synapses by their UUIDs for quick lookup
  const synapseFromMap = new Map<string, string[]>();
  const synapseToMap = new Map<string, string[]>();

  sortedSynapses.forEach((synapse) => {
    if (!synapseFromMap.has(synapse.fromUUID)) {
      synapseFromMap.set(synapse.fromUUID, []);
    }
    synapseFromMap.get(synapse.fromUUID)!.push(synapse.toUUID);

    if (!synapseToMap.has(synapse.toUUID)) {
      synapseToMap.set(synapse.toUUID, []);
    }
    synapseToMap.get(synapse.toUUID)!.push(synapse.fromUUID);
  });

  // Create composite keys for neurons based on their connected synapses
  creature.neurons.forEach((neuron) => {
    if (neuron.type === "hidden") {
      const incomingKeys = (synapseToMap.get(neuron.uuid) || []).join("-");
      const outgoingKeys = (synapseFromMap.get(neuron.uuid) || []).join("-");
      const key = `${incomingKeys}|${outgoingKeys}`;
      keyMap.set(key, neuron);
    }
  });

  return keyMap;
}

export function createCompatibleFather(
  mother: CreatureExport,
  father: CreatureExport,
): CreatureExport {
  const uuidMapping = new Map<string, string>();
  const usedMotherUUIDs = new Set<string>();
  const usedFatherUUIDs = new Set<string>();

  // Create a set of all UUIDs in the mother's neurons
  const motherUUIDs = new Set(mother.neurons.map((neuron) => neuron.uuid));

  // Create a set of all UUIDs in the father's neurons
  const fatherUUIDs = new Set(father.neurons.map((neuron) => neuron.uuid));

  // Optimization: If all father's neurons' UUIDs are in the mother, return the father as-is
  if (father.neurons.every((neuron) => motherUUIDs.has(neuron.uuid))) {
    return father;
  }

  // Generate neuron key maps for both mother and father, using sorted synapses
  const motherKeyMap = generateNeuronKeyMap(mother);
  const fatherKeyMap = generateNeuronKeyMap(father);

  // Step 1: Identify matching neurons by composite key and populate the UUID mapping
  motherKeyMap.forEach((motherNeuron, motherKey) => {
    const matchingFatherNeurons = Array.from(fatherKeyMap.entries())
      .filter(([fatherKey]) => fatherKey === motherKey)
      .map(([, fatherNeuron]) => fatherNeuron);

    // Only map UUIDs that are not already present in the father and have not been used
    if (
      matchingFatherNeurons.length > 0 &&
      !fatherUUIDs.has(motherNeuron.uuid) &&
      !usedMotherUUIDs.has(motherNeuron.uuid)
    ) {
      // Randomly select one matching father neuron for the mapping
      const selectedFatherNeuron = matchingFatherNeurons[
        Math.floor(Math.random() * matchingFatherNeurons.length)
      ];

      uuidMapping.set(selectedFatherNeuron.uuid, motherNeuron.uuid);
      usedMotherUUIDs.add(motherNeuron.uuid);
      usedFatherUUIDs.add(selectedFatherNeuron.uuid);
    }
  });

  // Step 2: Apply UUID mappings to neurons, maintaining the original order
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

  delete adjustedFather.memetic;
  return adjustedFather;
}
