import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";

/**
 * Lightweight neuron info needed for compatibility check.
 * Avoids full JSON export overhead.
 */
interface NeuronInfo {
  id: number;
  type: "input" | "hidden" | "output" | "constant";
  bias: number;
  squash?: string;
}

/**
 * Synapse maps used for building composite neuron keys.
 * Issue #1444: Consolidated from duplicate implementations.
 */
interface SynapseMaps {
  /** Maps source neuron ID to sorted list of destination neuron IDs */
  fromMap: Map<number, number[]>;
  /** Maps destination neuron ID to sorted list of source neuron IDs */
  toMap: Map<number, number[]>;
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
  getFromId: (index: number) => number,
  getToId: (index: number) => number,
): SynapseMaps {
  const fromMap = new Map<number, number[]>();
  const toMap = new Map<number, number[]>();

  for (let i = 0; i < synapseCount; i++) {
    const fromId = getFromId(i);
    const toId = getToId(i);

    let fromList = fromMap.get(fromId);
    if (!fromList) {
      fromList = [];
      fromMap.set(fromId, fromList);
    }
    fromList.push(toId);

    let toList = toMap.get(toId);
    if (!toList) {
      toList = [];
      toMap.set(toId, toList);
    }
    toList.push(fromId);
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
  id: number,
  synapseMaps: SynapseMaps,
): string {
  const incomingKeys = (synapseMaps.toMap.get(id) || []).join("-");
  const outgoingKeys = (synapseMaps.fromMap.get(id) || []).join("-");
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

  // Build ID lookup for neurons (for converting synapse indices to UUIDs)
  const indexToId: number[] = new Array(neurons.length);
  for (let i = 0; i < neurons.length; i++) {
    indexToId[i] = neurons[i].id;
  }

  const synapseMaps = buildSynapseMaps(
    synapses.length,
    (i) => indexToId[synapses[i].from],
    (i) => indexToId[synapses[i].to],
  );

  for (const neuron of neurons) {
    if (neuron.type === "hidden") {
      const key = buildNeuronKey(neuron.id, synapseMaps);
      keyMap.set(key, {
        id: neuron.id,
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
    (i) => synapses[i].fromId,
    (i) => synapses[i].toId,
  );

  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") {
      const key = buildNeuronKey(neuron.id, synapseMaps);
      keyMap.set(key, neuron);
    }
  }

  return keyMap;
}

export function createCompatibleFather(
  mother: CreatureExport,
  father: CreatureExport,
): CreatureExport {
  const idMapping = new Map<number, number>();
  const usedMotherIds = new Set<number>();
  const usedFatherIds = new Set<number>();

  // Create a set of all IDs in the mother's neurons
  const motherIds = new Set(mother.neurons.map((neuron) => neuron.id));

  // Create a set of all IDs in the father's neurons
  const fatherIds = new Set(father.neurons.map((neuron) => neuron.id));

  // Optimization: If all father's neurons' IDs are in the mother, return the father as-is
  if (father.neurons.every((neuron) => motherIds.has(neuron.id))) {
    return father;
  }

  // Generate neuron key maps for both mother and father, using sorted synapses
  const motherKeyMap = generateNeuronKeyMap(mother);
  const fatherKeyMap = generateNeuronKeyMap(father);

  // Step 1: Identify matching neurons by composite key and populate the UUID mapping.
  // Issue #1644: Direct Map lookup O(1) replaces Array.from().filter() O(n) per key.
  motherKeyMap.forEach((motherNeuron, motherKey) => {
    const matchingFatherNeuron = fatherKeyMap.get(motherKey);

    // Only map IDs that are not already present in the father and have not been used
    if (
      matchingFatherNeuron &&
      !fatherIds.has(motherNeuron.id) &&
      !usedMotherIds.has(motherNeuron.id)
    ) {
      idMapping.set(matchingFatherNeuron.id, motherNeuron.id);
      usedMotherIds.add(motherNeuron.id);
      usedFatherIds.add(matchingFatherNeuron.id);
    }
  });

  // Step 2: Apply ID mappings to neurons, maintaining the original order
  const newNeurons = father.neurons.map((fatherNeuron) => {
    const newId = idMapping.get(fatherNeuron.id);
    if (newId) {
      return {
        ...fatherNeuron,
        uuid: newId,
      };
    }
    return fatherNeuron;
  });

  // Step 3: Apply ID mappings to synapses
  const newSynapses = father.synapses.map((synapse) => {
    const updatedFromUUID = idMapping.get(synapse.fromId) ||
      synapse.fromId;
    const updatedToUUID = idMapping.get(synapse.toId) || synapse.toId;
    return {
      ...synapse,
      fromId: updatedFromUUID,
      toId: updatedToUUID,
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
  const idMapping = new Map<number, number>();
  const usedMotherIds = new Set<number>();
  // usedFatherIds tracking kept for parity with original algorithm

  const motherNeurons = mother.neurons;
  const fatherNeurons = father.neurons;
  const fatherSynapses = father.synapses;

  // Create a set of all IDs in the mother's neurons
  const motherIds = new Set<number>();
  for (const neuron of motherNeurons) {
    motherIds.add(neuron.id);
  }

  // Create a set of all IDs in the father's neurons
  const fatherIds = new Set<number>();
  for (const neuron of fatherNeurons) {
    fatherIds.add(neuron.id);
  }

  // Optimisation: If all father's neurons' IDs are in the mother, return the father as-is
  // We still need to export in this case, but we can skip the compatibility calculations
  let allFatherInMother = true;
  for (const neuron of fatherNeurons) {
    if (!motherIds.has(neuron.id)) {
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

  // Step 1: Identify matching neurons by composite key and populate the UUID mapping.
  // Issue #1644: Direct Map lookup O(1) replaces Array.from().filter() O(n) per key.
  motherKeyMap.forEach((motherNeuron, motherKey) => {
    const matchingFatherNeuron = fatherKeyMap.get(motherKey);

    // Only map IDs that are not already present in the father and have not been used
    if (
      matchingFatherNeuron &&
      !fatherIds.has(motherNeuron.id) &&
      !usedMotherIds.has(motherNeuron.id)
    ) {
      idMapping.set(matchingFatherNeuron.id, motherNeuron.id);
      usedMotherIds.add(motherNeuron.id);
    }
  });

  // Build index to UUID lookup for father
  const fatherIndexToId: number[] = new Array(fatherNeurons.length);
  for (let i = 0; i < fatherNeurons.length; i++) {
    fatherIndexToId[i] = fatherNeurons[i].id;
  }

  // Step 2: Build the exported neurons with UUID mappings applied
  const newNeurons: NeuronExport[] = [];
  for (const neuron of fatherNeurons) {
    if (neuron.type === "input") continue;

    const newId = idMapping.get(neuron.id) || neuron.id;
    const exportNeuron: NeuronExport = {
      type: neuron.type as "hidden" | "output" | "constant",
      id: newId,
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
    const fromId = fatherIndexToId[synapse.from];
    const toId = fatherIndexToId[synapse.to];

    const updatedFromUUID = idMapping.get(fromId) || fromId;
    const updatedToUUID = idMapping.get(toId) || toId;

    const exportSynapse: CreatureExport["synapses"][0] = {
      fromId: updatedFromUUID,
      toId: updatedToUUID,
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
