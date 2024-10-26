import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "../../architecture/SynapseInterfaces.ts";

export function calculatePathsToOutput(
  selectedNeurons: Readonly<Set<string>>,
  creature: CreatureExport,
): Readonly<Set<string>> {
  // Create a set to keep track of all neurons that are part of the paths.
  const pathNeurons = new Set<string>(selectedNeurons);

  // Map from each neuron UUID to synapses that originate from it.
  const outgoingSynapsesMap = new Map<string, SynapseExport[]>();

  // Populate the map with synapses grouped by their origin (fromUUID).
  creature.synapses.forEach((synapse) => {
    if (!outgoingSynapsesMap.has(synapse.fromUUID)) {
      outgoingSynapsesMap.set(synapse.fromUUID, []);
    }
    outgoingSynapsesMap.get(synapse.fromUUID)!.push(synapse);
  });

  // Use a queue for breadth-first search (BFS) starting from selected neurons.
  const queue = Array.from(selectedNeurons);

  // Perform BFS to find all neurons connected forward from the selected ones.
  while (queue.length > 0) {
    const currentNeuronUUID = queue.shift()!;

    // Get all outgoing synapses from this neuron.
    const outgoingSynapses = outgoingSynapsesMap.get(currentNeuronUUID) || [];

    // Iterate through each outgoing synapse.
    for (const synapse of outgoingSynapses) {
      const toUUID = synapse.toUUID;

      // If the target neuron is not already in the path, add it and enqueue it.
      if (!pathNeurons.has(toUUID)) {
        pathNeurons.add(toUUID);
        queue.push(toUUID);
      }
    }
  }

  // Freeze the set to make it immutable.
  return Object.freeze(pathNeurons);
}
