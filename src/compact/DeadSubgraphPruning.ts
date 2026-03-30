import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { CreatureExportBuilder } from "@utils/CreatureExportBuilder.ts";

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
  normaliseCreatureExport(creatureExport);
  // Build reverse adjacency: toId -> set(fromId)
  const incoming = new Map<number, Set<number>>();
  for (const synapse of creatureExport.synapses) {
    let set = incoming.get(synapse.toId!);
    if (!set) {
      set = new Set<number>();
      incoming.set(synapse.toId!, set);
    }
    set.add(synapse.fromId!);
  }

  // Seed BFS from all outputs.
  const canReachOutput = new Set<number>();
  const queue: number[] = [];
  for (const neuron of creatureExport.neurons) {
    if (neuron.type === "output") {
      canReachOutput.add(neuron.id!);
      queue.push(neuron.id!);
    }
  }

  // Reverse traversal: collect all ancestors of outputs.
  while (queue.length) {
    const current = queue.pop()!;
    const parents = incoming.get(current);
    if (!parents) continue;
    for (const fromId of parents) {
      if (!canReachOutput.has(fromId)) {
        canReachOutput.add(fromId);
        queue.push(fromId);
      }
    }
  }

  const toRemove = new Set<number>();
  for (const neuron of creatureExport.neurons) {
    if (neuron.type === "hidden" || neuron.type === "constant") {
      if (!canReachOutput.has(neuron.id!)) {
        toRemove.add(neuron.id!);
      }
    }
  }

  if (toRemove.size === 0) {
    return { removedNeurons: 0, removedSynapses: 0 };
  }

  const beforeSynapses = creatureExport.synapses.length;
  creatureExport.neurons = creatureExport.neurons.filter((n) =>
    !toRemove.has(n.id!)
  );
  creatureExport.synapses = creatureExport.synapses.filter((s) =>
    !toRemove.has(s.fromId!) && !toRemove.has(s.toId!)
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
  const exportJSON = builder.build(true);

  const result = pruneDeadSubgraphs(exportJSON);
  if (result.removedNeurons > 0 || result.removedSynapses > 0) {
    creature.loadFrom(exportJSON, true);
  }

  return result;
}
