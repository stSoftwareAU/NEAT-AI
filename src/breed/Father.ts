import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";

/**
 * Lightweight neuron info needed for compatibility check.
 * Avoids full JSON export overhead.
 */
interface NeuronInfo {
  uuid: string;
  type: "input" | "hidden" | "output" | "constant";
  bias: number;
  squash?: string;
}

/**
 * Generates a key map from Creature objects directly without JSON export.
 * This is the optimised version for issue #1034.
 */
function generateNeuronKeyMapFromCreature(
  creature: Creature,
): Map<string, NeuronInfo> {
  const keyMap = new Map<string, NeuronInfo>();
  const neurons = creature.neurons;
  const synapses = creature.synapses;

  // Build UUID lookup for neurons (for converting synapse indices to UUIDs)
  // Pre-allocate array size for performance
  const indexToUUID: string[] = new Array(neurons.length);
  for (let i = 0; i < neurons.length; i++) {
    indexToUUID[i] = neurons[i].uuid;
  }

  // Collect synapses with UUIDs, sorted for consistent key generation
  const synapseInfos: { fromUUID: string; toUUID: string }[] = new Array(
    synapses.length,
  );
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    synapseInfos[i] = {
      fromUUID: indexToUUID[s.from],
      toUUID: indexToUUID[s.to],
    };
  }

  // Sort synapses by fromUUID and toUUID to ensure consistent key generation
  synapseInfos.sort((a, b) => {
    if (a.fromUUID < b.fromUUID) return -1;
    if (a.fromUUID > b.fromUUID) return 1;
    if (a.toUUID < b.toUUID) return -1;
    if (a.toUUID > b.toUUID) return 1;
    return 0;
  });

  // Map synapses by their UUIDs for quick lookup
  const synapseFromMap = new Map<string, string[]>();
  const synapseToMap = new Map<string, string[]>();

  for (const synapse of synapseInfos) {
    let fromList = synapseFromMap.get(synapse.fromUUID);
    if (!fromList) {
      fromList = [];
      synapseFromMap.set(synapse.fromUUID, fromList);
    }
    fromList.push(synapse.toUUID);

    let toList = synapseToMap.get(synapse.toUUID);
    if (!toList) {
      toList = [];
      synapseToMap.set(synapse.toUUID, toList);
    }
    toList.push(synapse.fromUUID);
  }

  // Create composite keys for neurons based on their connected synapses
  for (const neuron of neurons) {
    if (neuron.type === "hidden") {
      const incomingKeys = (synapseToMap.get(neuron.uuid) || []).join("-");
      const outgoingKeys = (synapseFromMap.get(neuron.uuid) || []).join("-");
      const key = `${incomingKeys}|${outgoingKeys}`;
      keyMap.set(key, {
        uuid: neuron.uuid,
        type: neuron.type,
        bias: neuron.bias,
        squash: neuron.squash,
      });
    }
  }

  return keyMap;
}

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

/**
 * Optimised version of createCompatibleFather that accepts Creature objects directly.
 * Avoids expensive JSON export operations during parent selection.
 *
 * Issue #1034: Performance - Avoid JSON exports in parent selection compatibility check.
 *
 * @param mother - The mother creature (accessed directly, not exported)
 * @param father - The father creature (accessed directly, not exported)
 * @returns A CreatureExport with the father's neurons mapped to be compatible with the mother
 */
export function createCompatibleFatherFromCreatures(
  mother: Creature,
  father: Creature,
): CreatureExport {
  const uuidMapping = new Map<string, string>();
  const usedMotherUUIDs = new Set<string>();
  // usedFatherUUIDs tracking kept for parity with original algorithm

  const motherNeurons = mother.neurons;
  const fatherNeurons = father.neurons;
  const fatherSynapses = father.synapses;

  // Create a set of all UUIDs in the mother's neurons
  const motherUUIDs = new Set<string>();
  for (const neuron of motherNeurons) {
    motherUUIDs.add(neuron.uuid);
  }

  // Create a set of all UUIDs in the father's neurons
  const fatherUUIDs = new Set<string>();
  for (const neuron of fatherNeurons) {
    fatherUUIDs.add(neuron.uuid);
  }

  // Optimisation: If all father's neurons' UUIDs are in the mother, return the father as-is
  // We still need to export in this case, but we can skip the compatibility calculations
  let allFatherInMother = true;
  for (const neuron of fatherNeurons) {
    if (!motherUUIDs.has(neuron.uuid)) {
      allFatherInMother = false;
      break;
    }
  }

  if (allFatherInMother) {
    return father.exportJSON();
  }

  // Generate neuron key maps for both mother and father, using Creature objects directly
  const motherKeyMap = generateNeuronKeyMapFromCreature(mother);
  const fatherKeyMap = generateNeuronKeyMapFromCreature(father);

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
    }
  });

  // Build index to UUID lookup for father
  const fatherIndexToUUID: string[] = new Array(fatherNeurons.length);
  for (let i = 0; i < fatherNeurons.length; i++) {
    fatherIndexToUUID[i] = fatherNeurons[i].uuid;
  }

  // Step 2: Build the exported neurons with UUID mappings applied
  const newNeurons: NeuronExport[] = [];
  for (const neuron of fatherNeurons) {
    if (neuron.type === "input") continue;

    const newUUID = uuidMapping.get(neuron.uuid) || neuron.uuid;
    const exportNeuron: NeuronExport = {
      type: neuron.type as "hidden" | "output" | "constant",
      uuid: newUUID,
      bias: neuron.bias,
    };
    if (neuron.squash) {
      exportNeuron.squash = neuron.squash;
    }
    // Copy tags if present
    if ((neuron as { tags?: unknown }).tags) {
      (exportNeuron as { tags?: unknown }).tags =
        (neuron as { tags: unknown }).tags;
    }
    newNeurons.push(exportNeuron);
  }

  // Step 3: Build the exported synapses with UUID mappings applied
  const newSynapses: CreatureExport["synapses"] = [];
  for (const synapse of fatherSynapses) {
    const fromUUID = fatherIndexToUUID[synapse.from];
    const toUUID = fatherIndexToUUID[synapse.to];

    const updatedFromUUID = uuidMapping.get(fromUUID) || fromUUID;
    const updatedToUUID = uuidMapping.get(toUUID) || toUUID;

    const exportSynapse: CreatureExport["synapses"][0] = {
      fromUUID: updatedFromUUID,
      toUUID: updatedToUUID,
      weight: synapse.weight,
    };
    if (synapse.type) {
      exportSynapse.type = synapse.type;
    }
    // Copy tags if present
    if (synapse.tags) {
      exportSynapse.tags = synapse.tags;
    }
    newSynapses.push(exportSynapse);
  }

  // Step 4: Return the updated father creature export
  const adjustedFather: CreatureExport = {
    input: father.input,
    output: father.output,
    neurons: newNeurons,
    synapses: newSynapses,
  };

  // Copy other properties from father if they exist (matching exportJSON() behaviour)
  if (father.tags && father.tags.length > 0) {
    adjustedFather.tags = father.tags;
  }
  if (father.semanticVersion) {
    adjustedFather.semanticVersion = father.semanticVersion;
  }
  if (father.forwardOnly === true) {
    adjustedFather.forwardOnly = father.forwardOnly;
  }
  // Note: memetic is intentionally not copied, matching original behaviour

  return adjustedFather;
}
