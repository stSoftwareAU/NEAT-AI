import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import type { NeuronStateInterface } from "@architecture/CreatureState.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

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
  neuronErrors?: ReadonlyMap<number, NeuronStateInterface>,
): Readonly<Set<number>> {
  normaliseCreatureExport(creature);
  // Handle the special case where sparseRatio is 1.
  if (config.sparseRatio === 1) {
    const allNeurons = new Set(
      creature.neurons
        .filter((neuron) =>
          neuron.type === "hidden" || neuron.type === "output"
        )
        .map((neuron) => neuron.id!),
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
  const selectedNeurons = new Set<number>();
  const queue: number[] = [];

  // Select the initial neurons up to the required number.
  const hasErrorData = neuronErrors !== undefined && neuronErrors.size > 0;
  for (let i = 0; i < numberOfNeuronsToSelect; i++) {
    const neuronId = eligibleNeurons[i].id!;
    // When error-guided, add directly to selectedNeurons to guarantee
    // high-error neurons are included (they are sorted first).
    if (hasErrorData) {
      selectedNeurons.add(neuronId);
    }
    queue.push(neuronId);
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
  neurons: { id?: number; type: string }[],
  neuronErrors: ReadonlyMap<number, NeuronStateInterface>,
): void {
  // First shuffle to break ties randomly
  fisherYatesShuffle(neurons);

  // Then stable-sort by descending error (high error neurons first)
  neurons.sort((a, b) => {
    const errorA = neuronErrors.get(a.id!)?.totalErrorAbsolute ?? 0;
    const errorB = neuronErrors.get(b.id!)?.totalErrorAbsolute ?? 0;
    return errorB - errorA;
  });
}

function fisherYatesShuffle<T>(array: T[]): void {
  const rng = getRandomNumberGenerator();
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1)); // Get a random index from 0 to i (inclusive)
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements at index i and j
  }
}

// Build a map from each neuron to the synapses connected to it.
// Single-pass optimisation: combines both fromUUID and toUUID processing.
// See issue #1029 for performance analysis.
function buildSynapseMap(creature: CreatureExport): Map<number, Set<number>> {
  const validNeurons = new Set<number>();
  creature.neurons.forEach((neuron) => {
    if (neuron.type === "hidden" || neuron.type === "output") {
      validNeurons.add(neuron.id!);
    }
  });

  const synapseMap = new Map<number, Set<number>>();

  creature.synapses.forEach((synapse) => {
    const fromValid = validNeurons.has(synapse.fromId!);
    const toValid = validNeurons.has(synapse.toId!);

    // Only process synapses where both endpoints are valid neurons
    if (fromValid && toValid) {
      // Add fromUUID -> toUUID connection
      if (!synapseMap.has(synapse.fromId!)) {
        synapseMap.set(synapse.fromId!, new Set());
      }
      synapseMap.get(synapse.fromId!)!.add(synapse.toId!);

      // Add toUUID -> fromUUID connection (bidirectional for neighbour lookup)
      if (!synapseMap.has(synapse.toId!)) {
        synapseMap.set(synapse.toId!, new Set());
      }
      synapseMap.get(synapse.toId!)!.add(synapse.fromId!);
    }
  });

  return synapseMap;
}

// Retrieve neurons connected by one or two steps from the given neuron.
// Uses index pointer instead of Array.shift() for O(1) dequeue operations.
// See issue #1030 for performance analysis.
function getConnectedNeurons(
  neuronId: number,
  synapseMap: Map<number, Set<number>>,
  steps: number,
): Set<number> {
  const connectedNeurons = new Set<number>();
  const queue = [{ neuronId, depth: 0 }];
  let front = 0;

  while (front < queue.length) {
    const { neuronId: current, depth } = queue[front++];

    // Stop expanding once we reach the specified depth.
    if (depth >= steps) continue;

    const neighbours = synapseMap.get(current) || new Set();
    for (const neighbour of neighbours) {
      if (!connectedNeurons.has(neighbour)) {
        connectedNeurons.add(neighbour);
        queue.push({ neuronId: neighbour, depth: depth + 1 });
      }
    }
  }

  return connectedNeurons;
}
