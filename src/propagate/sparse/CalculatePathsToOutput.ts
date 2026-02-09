import type { CreatureExport } from "../../architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "../../architecture/SynapseInterfaces.ts";

/** Outgoing synapse map: fromUUID -> synapses originating from that neuron. */
export type OutgoingSynapsesMap = ReadonlyMap<string, SynapseExport[]>;

/**
 * Builds a map from each neuron UUID to the synapses that originate from it.
 * This map can be cached and reused across multiple calls to
 * `calculatePathsToOutput` when the creature topology is unchanged.
 *
 * Issue #1294: Extracted for caching — map construction is O(synapses) and
 * dominated the overall `calculatePathsToOutput` cost (~98% of runtime).
 */
export function buildOutgoingSynapsesMap(
  creature: CreatureExport,
): OutgoingSynapsesMap {
  const map = new Map<string, SynapseExport[]>();
  for (const synapse of creature.synapses) {
    let list = map.get(synapse.fromUUID);
    if (list === undefined) {
      list = [];
      map.set(synapse.fromUUID, list);
    }
    list.push(synapse);
  }
  return map;
}

/**
 * Calculates all neurons on paths from the selected neurons to the outputs.
 *
 * Uses BFS to trace forward through the synapse graph. An optional pre-built
 * `outgoingSynapsesMap` can be supplied to avoid rebuilding the map on every
 * call (Issue #1294). When omitted the map is built internally.
 *
 * Issue #1030: Uses an index pointer instead of `Array.shift()` for O(1)
 * dequeue operations.
 */
export function calculatePathsToOutput(
  selectedNeurons: Readonly<Set<string>>,
  creature: CreatureExport,
  outgoingSynapsesMap?: OutgoingSynapsesMap,
): Readonly<Set<string>> {
  const map = outgoingSynapsesMap ?? buildOutgoingSynapsesMap(creature);

  // Create a set to keep track of all neurons that are part of the paths.
  const pathNeurons = new Set<string>(selectedNeurons);

  // Use a queue with index pointer for BFS starting from selected neurons.
  const queue = Array.from(selectedNeurons);
  let front = 0;

  // Perform BFS to find all neurons connected forward from the selected ones.
  while (front < queue.length) {
    const currentNeuronUUID = queue[front++];

    // Get all outgoing synapses from this neuron.
    const outgoingSynapses = map.get(currentNeuronUUID) || [];

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
