import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

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
 * Synapse maps used for building composite neuron keys.
 * Issue #1444: Consolidated from duplicate implementations.
 */
interface SynapseMaps {
  /** Maps source UUID to sorted list of destination UUIDs */
  fromMap: Map<string, string[]>;
  /** Maps destination UUID to sorted list of source UUIDs */
  toMap: Map<string, string[]>;
}

/**
 * Builds synapse lookup maps from UUID pairs without allocating a sorted copy.
 *
 * Issue #1444: Consolidated from two duplicate implementations. Instead of
 * spreading all synapses into a new array and sorting globally (O(n log n) +
 * allocation), this builds maps in O(n) and sorts only the individual
 * per-neuron lists. Since each neuron typically has far fewer connections
 * than the total synapse count, this reduces overall work.
 */
function buildSynapseMaps(
  synapseCount: number,
  getFromUUID: (index: number) => string,
  getToUUID: (index: number) => string,
): SynapseMaps {
  const fromMap = new Map<string, string[]>();
  const toMap = new Map<string, string[]>();

  for (let i = 0; i < synapseCount; i++) {
    const fromUUID = getFromUUID(i);
    const toUUID = getToUUID(i);

    let fromList = fromMap.get(fromUUID);
    if (!fromList) {
      fromList = [];
      fromMap.set(fromUUID, fromList);
    }
    fromList.push(toUUID);

    let toList = toMap.get(toUUID);
    if (!toList) {
      toList = [];
      toMap.set(toUUID, toList);
    }
    toList.push(fromUUID);
  }

  // Sort individual per-neuron lists for consistent key generation
  for (const list of fromMap.values()) {
    list.sort();
  }
  for (const list of toMap.values()) {
    list.sort();
  }

  return { fromMap, toMap };
}

/**
 * Builds a composite key for a hidden neuron based on its connected synapses.
 */
function buildNeuronKey(
  uuid: string,
  synapseMaps: SynapseMaps,
): string {
  const incomingKeys = (synapseMaps.toMap.get(uuid) || []).join("-");
  const outgoingKeys = (synapseMaps.fromMap.get(uuid) || []).join("-");
  return `${incomingKeys}|${outgoingKeys}`;
}

/**
 * Generates a key map from Creature objects directly without JSON export.
 * Issue #1034: Optimised version. Issue #1444: Uses consolidated buildSynapseMaps.
 */
function generateNeuronKeyMapFromCreature(
  creature: Creature,
): Map<string, NeuronInfo> {
  const keyMap = new Map<string, NeuronInfo>();
  const neurons = creature.neurons;
  const synapses = creature.synapses;

  // Build UUID lookup for neurons (for converting synapse indices to UUIDs)
  const indexToUUID: string[] = new Array(neurons.length);
  for (let i = 0; i < neurons.length; i++) {
    indexToUUID[i] = neurons[i].uuid;
  }

  const synapseMaps = buildSynapseMaps(
    synapses.length,
    (i) => indexToUUID[synapses[i].from],
    (i) => indexToUUID[synapses[i].to],
  );

  for (const neuron of neurons) {
    if (neuron.type === "hidden") {
      const key = buildNeuronKey(neuron.uuid, synapseMaps);
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

/**
 * Generates a key map from CreatureExport without array spread/sort overhead.
 * Issue #1444: Uses consolidated buildSynapseMaps instead of [...synapses].sort().
 */
function generateNeuronKeyMap(
  creature: CreatureExport,
): Map<string, NeuronExport> {
  const keyMap = new Map<string, NeuronExport>();
  const synapses = creature.synapses;

  const synapseMaps = buildSynapseMaps(
    synapses.length,
    (i) => synapses[i].fromUUID,
    (i) => synapses[i].toUUID,
  );

  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") {
      const key = buildNeuronKey(neuron.uuid, synapseMaps);
      keyMap.set(key, neuron);
    }
  }

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
      const rng = getRandomNumberGenerator();
      const selectedFatherNeuron = matchingFatherNeurons[
        Math.floor(rng.random() * matchingFatherNeurons.length)
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
      const rng = getRandomNumberGenerator();
      const selectedFatherNeuron = matchingFatherNeurons[
        Math.floor(rng.random() * matchingFatherNeurons.length)
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
