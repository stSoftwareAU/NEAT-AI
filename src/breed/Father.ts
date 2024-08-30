import { Creature } from "../../mod.ts";
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

  // For each neuron, create a composite key from its connected synapses
  creature.neurons.forEach((neuron) => {
    if (neuron.type === "hidden") {
      const incomingSynapses = sortedSynapses.filter((s) =>
        s.toUUID === neuron.uuid
      );
      const outgoingSynapses = sortedSynapses.filter((s) =>
        s.fromUUID === neuron.uuid
      );

      const key = `${incomingSynapses.map((s) => s.fromUUID).join("-")}|${
        outgoingSynapses.map((s) => s.toUUID).join("-")
      }`;

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

  // Create a set of all UUIDs in the mother's neurons
  const motherUUIDs = new Set(mother.neurons.map((neuron) => neuron.uuid));

  // Create a set of all UUIDs in the father's neurons
  const fatherUUIDs = new Set(father.neurons.map((neuron) => neuron.uuid));

  // Optimization: If all father's neurons' UUIDs are in the mother, return the father as-is
  const allUUIDsMatch = father.neurons.every((neuron) =>
    motherUUIDs.has(neuron.uuid)
  );

  if (allUUIDsMatch) {
    return father;
  }

  // Generate the neuron key maps for both mother and father
  const motherKeyMap = generateNeuronKeyMap(mother);
  const fatherKeyMap = generateNeuronKeyMap(father);

  // Step 1: Identify matching neurons by composite key and populate the UUID mapping
  motherKeyMap.forEach((motherNeuron, motherKey) => {
    const matchingFatherNeuron = fatherKeyMap.get(motherKey);

    // Only map UUIDs that are not already present in the father and have not been used
    if (
      matchingFatherNeuron &&
      !fatherUUIDs.has(motherNeuron.uuid) &&
      !usedMotherUUIDs.has(motherNeuron.uuid)
    ) {
      uuidMapping.set(matchingFatherNeuron.uuid, motherNeuron.uuid);
      usedMotherUUIDs.add(motherNeuron.uuid);
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

  delete adjustedFather.memetic;

  try {
    Creature.fromJSON(adjustedFather).validate();
  } catch (e) {
    Deno.writeTextFileSync(
      "./.source_mother.json",
      JSON.stringify(mother, null, 2),
    );
    Deno.writeTextFileSync(
      "./.source_father.json",
      JSON.stringify(father, null, 2),
    );
    Deno.writeTextFileSync(
      "./.invalid_father.json",
      JSON.stringify(adjustedFather, null, 2),
    );
    throw e;
  }
  return adjustedFather;
}
