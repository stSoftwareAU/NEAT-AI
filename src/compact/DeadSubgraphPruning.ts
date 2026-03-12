import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";

export interface PruneDeadSubgraphsResult {
  removedNeurons: number;
  removedSynapses: number;
}

/**
 * Prunes "dead" subgraphs: hidden/constant neurons (and their synapses) that
 * cannot influence any output.
 *
 * A neuron can influence an output if there is at least one directed path from
 * that neuron to any output neuron.
 *
 * This is behaviour-preserving for forward passes: removed elements were not
 * able to affect any output activation.
 *
 * Notes:
 * - Inputs are implicit (UUIDs like `input-0`) and are never removed.
 * - Outputs are never removed.
 * - This function modifies the CreatureExport in place.
 *
 * @param creatureExport - The CreatureExport to prune (modified in place).
 * @returns Counts of removed neurons and removed synapses.
 */
export function pruneDeadSubgraphs(
  creatureExport: CreatureExport,
): PruneDeadSubgraphsResult {
  // Build reverse adjacency: toUUID -> set(fromUUID)
  const incoming = new Map<string, Set<string>>();
  for (const synapse of creatureExport.synapses) {
    let set = incoming.get(synapse.toUUID);
    if (!set) {
      set = new Set<string>();
      incoming.set(synapse.toUUID, set);
    }
    set.add(synapse.fromUUID);
  }

  // Seed BFS from all outputs.
  const canReachOutput = new Set<string>();
  const queue: string[] = [];
  for (const neuron of creatureExport.neurons) {
    if (neuron.type === "output") {
      canReachOutput.add(neuron.uuid);
      queue.push(neuron.uuid);
    }
  }

  // Reverse traversal: collect all ancestors of outputs.
  while (queue.length) {
    const current = queue.pop()!;
    const parents = incoming.get(current);
    if (!parents) continue;
    for (const fromUUID of parents) {
      if (!canReachOutput.has(fromUUID)) {
        canReachOutput.add(fromUUID);
        queue.push(fromUUID);
      }
    }
  }

  const toRemove = new Set<string>();
  for (const neuron of creatureExport.neurons) {
    if (neuron.type === "hidden" || neuron.type === "constant") {
      if (!canReachOutput.has(neuron.uuid)) {
        toRemove.add(neuron.uuid);
      }
    }
  }

  if (toRemove.size === 0) {
    return { removedNeurons: 0, removedSynapses: 0 };
  }

  const beforeSynapses = creatureExport.synapses.length;
  creatureExport.neurons = creatureExport.neurons.filter((n) =>
    !toRemove.has(n.uuid)
  );
  creatureExport.synapses = creatureExport.synapses.filter((s) =>
    !toRemove.has(s.fromUUID) && !toRemove.has(s.toUUID)
  );

  // Structure changed, so cached memetic references are no longer trustworthy.
  delete creatureExport.memetic;

  return {
    removedNeurons: toRemove.size,
    removedSynapses: beforeSynapses - creatureExport.synapses.length,
  };
}

/**
 * Prunes dead subgraphs from a live Creature instance.
 *
 * This is a convenience wrapper that exports the creature to JSON (without
 * validation, to allow intermediate invalid states), prunes dead subgraphs, and
 * reloads the creature if any modifications were made.
 *
 * @param creature - The Creature to prune (modified in place).
 * @returns Counts of removed neurons and removed synapses.
 */
export function pruneDeadSubgraphsInCreature(
  creature: Creature,
): PruneDeadSubgraphsResult {
  // Use the builder directly to bypass validation (creature may be in an intermediate state)
  const builder = new CreatureExportBuilder(creature);
  const exportJSON = builder.build();

  const result = pruneDeadSubgraphs(exportJSON);
  if (result.removedNeurons > 0 || result.removedSynapses > 0) {
    creature.loadFrom(exportJSON, true);
  }

  return result;
}
