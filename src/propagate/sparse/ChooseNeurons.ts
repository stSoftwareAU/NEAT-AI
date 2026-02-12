import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { NeuronStateInterface } from "../../architecture/CreatureState.ts";
import type { BackPropagationConfig } from "../BackPropagation.ts";

/**
 * Selects neurons for sparse backpropagation training.
 *
 * When neuronErrors are provided (from a previous iteration), uses error-guided
 * selection: neurons with higher accumulated error are prioritised, as they
 * have the most room for improvement. Falls back to random selection when
 * no error data is available.
 *
 * @param creature - The exported creature definition
 * @param config - Backpropagation configuration (includes sparseRatio)
 * @param neuronErrors - Optional per-neuron error data from previous iteration
 */
export function chooseNeurons(
  creature: CreatureExport,
  config: BackPropagationConfig,
  neuronErrors?: ReadonlyMap<string, NeuronStateInterface>,
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

  // Sort or shuffle eligible neurons based on error data availability.
  if (neuronErrors && neuronErrors.size > 0) {
    // Error-guided selection: sort by descending totalErrorAbsolute.
    // Neurons with higher accumulated error are prioritised for training
    // as they have the most room for improvement.
    errorGuidedSort(eligibleNeurons, neuronErrors);
  } else {
    // No error data available: fall back to random selection.
    fisherYatesShuffle(eligibleNeurons);
  }

  // Set of chosen neurons and a queue to expand the cluster.
  const selectedNeurons = new Set<string>();
  const queue: string[] = [];

  // Select the initial neurons up to the required number.
  const hasErrorData = neuronErrors !== undefined && neuronErrors.size > 0;
  for (let i = 0; i < numberOfNeuronsToSelect; i++) {
    const neuronUUID = eligibleNeurons[i].uuid;
    // When error-guided, add directly to selectedNeurons to guarantee
    // high-error neurons are included (they are sorted first).
    if (hasErrorData) {
      selectedNeurons.add(neuronUUID);
    }
    queue.push(neuronUUID);
  }

  // Map from each neuron UUID to the synapses that connect from or to it.
  const connectedSynapses = buildSynapseMap(creature);

  // Expand the cluster around each selected neuron.
  while (queue.length > 0 && selectedNeurons.size < numberOfNeuronsToSelect) {
    const currentNeuronUUID = queue.pop()!;

    selectedNeurons.add(currentNeuronUUID);

    // Get all neurons connected by one or two steps.
    const neighbours = getConnectedNeurons(
      currentNeuronUUID,
      connectedSynapses,
      2,
    );

    for (const neighbour of neighbours) {
      if (
        !selectedNeurons.has(neighbour) &&
        selectedNeurons.size < numberOfNeuronsToSelect
      ) {
        if (!selectedNeurons.has(neighbour)) {
          selectedNeurons.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
  }

  // Freeze the set to make it immutable.
  return Object.freeze(selectedNeurons);
}

/**
 * Sorts neurons by descending accumulated error, with randomisation among
 * neurons that have similar error levels to maintain exploration diversity.
 */
function errorGuidedSort(
  neurons: { uuid: string; type: string }[],
  neuronErrors: ReadonlyMap<string, NeuronStateInterface>,
): void {
  // First shuffle to break ties randomly
  fisherYatesShuffle(neurons);

  // Then stable-sort by descending error (high error neurons first)
  neurons.sort((a, b) => {
    const errorA = neuronErrors.get(a.uuid)?.totalErrorAbsolute ?? 0;
    const errorB = neuronErrors.get(b.uuid)?.totalErrorAbsolute ?? 0;
    return errorB - errorA;
  });
}

function fisherYatesShuffle<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // Get a random index from 0 to i (inclusive)
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements at index i and j
  }
}

// Build a map from each neuron to the synapses connected to it.
// Single-pass optimisation: combines both fromUUID and toUUID processing.
// See issue #1029 for performance analysis.
function buildSynapseMap(creature: CreatureExport): Map<string, Set<string>> {
  const validNeurons = new Set<string>();
  creature.neurons.forEach((neuron) => {
    if (neuron.type === "hidden" || neuron.type === "output") {
      validNeurons.add(neuron.uuid);
    }
  });

  const synapseMap = new Map<string, Set<string>>();

  creature.synapses.forEach((synapse) => {
    const fromValid = validNeurons.has(synapse.fromUUID);
    const toValid = validNeurons.has(synapse.toUUID);

    // Only process synapses where both endpoints are valid neurons
    if (fromValid && toValid) {
      // Add fromUUID -> toUUID connection
      if (!synapseMap.has(synapse.fromUUID)) {
        synapseMap.set(synapse.fromUUID, new Set());
      }
      synapseMap.get(synapse.fromUUID)!.add(synapse.toUUID);

      // Add toUUID -> fromUUID connection (bidirectional for neighbour lookup)
      if (!synapseMap.has(synapse.toUUID)) {
        synapseMap.set(synapse.toUUID, new Set());
      }
      synapseMap.get(synapse.toUUID)!.add(synapse.fromUUID);
    }
  });

  return synapseMap;
}

// Retrieve neurons connected by one or two steps from the given neuron.
// Uses index pointer instead of Array.shift() for O(1) dequeue operations.
// See issue #1030 for performance analysis.
function getConnectedNeurons(
  neuronUUID: string,
  synapseMap: Map<string, Set<string>>,
  steps: number,
): Set<string> {
  const connectedNeurons = new Set<string>();
  const queue = [{ neuronUUID, depth: 0 }];
  let front = 0;

  while (front < queue.length) {
    const { neuronUUID: current, depth } = queue[front++];

    // Stop expanding once we reach the specified depth.
    if (depth >= steps) continue;

    const neighbours = synapseMap.get(current) || new Set();
    for (const neighbour of neighbours) {
      if (!connectedNeurons.has(neighbour)) {
        connectedNeurons.add(neighbour);
        queue.push({ neuronUUID: neighbour, depth: depth + 1 });
      }
    }
  }

  return connectedNeurons;
}
