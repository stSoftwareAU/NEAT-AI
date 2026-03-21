/**
 * SyntheticSynapses.ts - Generate temporary zero-weight synapses between
 * adjacent layers for dense inter-layer connectivity.
 *
 * Issue #1921 - Creates synthetic synapses to fully connect neurons between
 * adjacent layers, allowing backpropagation to optimise connections that
 * NEAT's evolutionary process may not have discovered.
 *
 * Synthetic synapses:
 * - Have zero weight (no initial effect on network output)
 * - Are tracked via returned keys for later cleanup
 * - Skip constant neurons and frozen neurons as targets
 * - Use connectBatch() for efficient bulk insertion
 */

import type { Creature } from "../Creature.ts";
import { computeLayerAssignments } from "./LayerAssignment.ts";

/** Result of generating synthetic synapses. */
export interface SyntheticSynapsesResult {
  /** Number of synapses added to the creature. */
  addedCount: number;
  /** Set of "from-to" keys identifying which synapses are synthetic. */
  syntheticKeys: Set<string>;
}

/**
 * Generate synthetic zero-weight synapses between all neuron pairs in
 * adjacent layers.
 *
 * For each pair of adjacent layers (layer N and layer N+1), creates
 * zero-weight synapses from every neuron in layer N to every neuron in
 * layer N+1, skipping connections that already exist, constant neuron
 * targets, and frozen neuron targets.
 *
 * @param creature The creature to add synthetic synapses to (modified in place)
 * @returns The count of added synapses and a set of keys tracking them
 */
export function generateSyntheticSynapses(
  creature: Creature,
): SyntheticSynapsesResult {
  const layers = computeLayerAssignments(creature);
  const syntheticKeys = new Set<string>();

  // Sort layer numbers so we can iterate adjacent pairs.
  const layerNumbers = [...layers.keys()].sort((a, b) => a - b);

  if (layerNumbers.length < 2) {
    return { addedCount: 0, syntheticKeys };
  }

  // Pre-compute which neuron indices are invalid targets:
  // constant neurons and frozen neurons.
  const skipTargets = new Set<number>();
  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type === "constant" || neuron.type === "input") {
      skipTargets.add(i);
    } else if (neuron.frozen) {
      skipTargets.add(i);
    }
  }

  // Build the list of connections to add across all adjacent layer pairs.
  const connections: Array<{
    from: number;
    to: number;
    weight: number;
  }> = [];

  for (let i = 0; i < layerNumbers.length - 1; i++) {
    const sourceLayer = layers.get(layerNumbers[i])!;
    const targetLayer = layers.get(layerNumbers[i + 1])!;

    for (const fromIdx of sourceLayer) {
      for (const toIdx of targetLayer) {
        // Skip invalid targets.
        if (skipTargets.has(toIdx)) continue;

        // Skip if the connection already exists.
        if (creature.getSynapse(fromIdx, toIdx) !== null) continue;

        const key = `${fromIdx}-${toIdx}`;
        syntheticKeys.add(key);
        connections.push({ from: fromIdx, to: toIdx, weight: 0 });
      }
    }
  }

  if (connections.length > 0) {
    creature.connectBatch(connections);
  }

  return { addedCount: connections.length, syntheticKeys };
}
