import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { BackPropagationConfig } from "../BackPropagation.ts";

export function chooseNeurons(
  creature: CreatureExport,
  config: BackPropagationConfig,
): Readonly<Set<string>> {
  // Handle the special case where sparseRatio is 1.
  if (config.sparseRatio === 1) {
    const allNeurons = new Set(
      creature.neurons
        .filter((neuron) =>
          neuron.type === "hidden" || neuron.type === "output"
        )
        .map((neuron) => neuron.uuid),
    );
    return Object.freeze(allNeurons);
  }

  // Filter out neurons of type 'hidden' or 'output'.
  const eligibleNeurons = creature.neurons.filter(
    (neuron) => neuron.type === "hidden" || neuron.type === "output",
  );

  // Determine the number of neurons to select.
  const numberOfNeuronsToSelect = Math.max(
    1,
    Math.ceil(eligibleNeurons.length * config.sparseRatio),
  );

  // Shuffle the eligible neurons to get random starting points.
  fisherYatesShuffle(eligibleNeurons);

  // Set of chosen neurons and a queue to expand the cluster.
  const selectedNeurons = new Set<string>();
  const queue: string[] = [];

  // Select the initial neurons up to the required number.
  for (let i = 0; i < numberOfNeuronsToSelect; i++) {
    const neuronUUID = eligibleNeurons[i].uuid;
    queue.push(neuronUUID);
  }

  // Map from each neuron UUID to the synapses that connect from or to it.
  const connectedSynapses = buildSynapseMap(creature);

  // Expand the cluster around each selected neuron.
  while (queue.length > 0 && selectedNeurons.size < numberOfNeuronsToSelect) {
    const currentNeuronUUID = queue.shift()!;

    if (selectedNeurons.has(currentNeuronUUID)) continue;

    selectedNeurons.add(currentNeuronUUID);

    // Get all neurons connected by one or two steps.
    const neighbors = getConnectedNeurons(
      currentNeuronUUID,
      connectedSynapses,
      2,
    );

    for (const neighbor of neighbors) {
      if (
        !selectedNeurons.has(neighbor) &&
        selectedNeurons.size < numberOfNeuronsToSelect
      ) {
        selectedNeurons.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Freeze the set to make it immutable.
  return Object.freeze(selectedNeurons);
}

function fisherYatesShuffle<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // Get a random index from 0 to i (inclusive)
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements at index i and j
  }
}

// Build a map from each neuron to the synapses connected to it.
function buildSynapseMap(creature: CreatureExport): Map<string, Set<string>> {
  const validNeurons = new Set<string>();
  creature.neurons.filter((neuron) => {
    if (neuron.type === "hidden" || neuron.type === "output") {
      validNeurons.add(neuron.uuid);
    }
  });
  const synapseMap = new Map<string, Set<string>>();
  creature.synapses.forEach((synapse) => {
    if (!validNeurons.has(synapse.fromUUID)) return;
    if (!validNeurons.has(synapse.fromUUID)) return;

    if (!synapseMap.has(synapse.fromUUID)) {
      synapseMap.set(synapse.fromUUID, new Set());
    }

    synapseMap.get(synapse.fromUUID)!.add(synapse.toUUID);
  });

  creature.synapses.forEach((synapse) => {
    if (!validNeurons.has(synapse.toUUID)) return;
    if (!validNeurons.has(synapse.fromUUID)) return;
    if (!synapseMap.has(synapse.toUUID)) {
      synapseMap.set(synapse.toUUID, new Set());
    }

    synapseMap.get(synapse.toUUID)!.add(synapse.fromUUID);
  });
  return synapseMap;
}

// Retrieve neurons connected by one or two steps from the given neuron.
function getConnectedNeurons(
  neuronUUID: string,
  synapseMap: Map<string, Set<string>>,
  steps: number,
): Set<string> {
  const connectedNeurons = new Set<string>();
  const queue = [{ neuronUUID, depth: 0 }];

  while (queue.length > 0) {
    const { neuronUUID: current, depth } = queue.shift()!;

    // Stop expanding once we reach the specified depth.
    if (depth >= steps) continue;

    const neighbors = synapseMap.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (!connectedNeurons.has(neighbor)) {
        connectedNeurons.add(neighbor);
        queue.push({ neuronUUID: neighbor, depth: depth + 1 });
      }
    }
  }

  return connectedNeurons;
}
