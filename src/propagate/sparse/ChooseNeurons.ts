import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { BackPropagationConfig } from "../BackPropagation.ts";

export function chooseNeurons(
  creature: CreatureExport,
  config: BackPropagationConfig,
): Readonly<Set<string>> {
  // Filter out neurons of type 'hidden' or 'output'
  const eligibleNeurons = creature.neurons.filter(
    (neuron) => neuron.type === "hidden" || neuron.type === "output",
  );

  // Determine the sparse ratio, defaulting to Math.random() * Math.random() if not defined.
  const numberOfNeuronsToSelect = Math.max(
    1,
    Math.ceil(eligibleNeurons.length * config.sparseRatio),
  );

  // Shuffle the eligible neurons using the Fisher-Yates shuffle.
  fisherYatesShuffle(eligibleNeurons);

  // Select the required number of neurons after shuffling.
  const selectedNeurons = new Set<string>();
  for (let i = 0; i < numberOfNeuronsToSelect; i++) {
    selectedNeurons.add(eligibleNeurons[i].uuid);
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
