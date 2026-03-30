/**
 * SyntheticSynapses.ts - Generate temporary zero-weight synapses between
 * adjacent layers for dense inter-layer connectivity.
 *
 * Issue #1921 - Creates synthetic synapses to fully connect neurons between
 * adjacent layers, allowing backpropagation to optimise connections that
 * NEAT's evolutionary process may not have discovered.
 *
 * Issue #1924 - Per-target cap prevents combinatorial explosion with
 * production-sized creatures. When adjacent layers are wide (e.g.,
 * 180 x 220 = 39,600 potential pairs), evenly-spaced sampling limits
 * each target neuron to a manageable number of synthetic connections.
 *
 * Synthetic synapses:
 * - Have zero weight (no initial effect on network output)
 * - Are tracked via returned keys for later cleanup
 * - Skip constant neurons and frozen neurons as targets
 * - Use connectBatch() for efficient bulk insertion
 * - Are capped per target neuron to prevent memory/time blowup
 */

import type { Creature } from "../Creature.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";

/**
 * Maximum synthetic synapses per target neuron per layer pair.
 *
 * Prevents combinatorial explosion when adjacent layers are wide.
 * With production-scale creatures (1,000+ neurons), fully connecting
 * adjacent layers of width 200 x 220 would add 44,000 synapses for
 * just one layer pair. This cap keeps the total manageable while
 * still providing dense connectivity for backpropagation to exploit.
 *
 * Issue #1924.
 */
export const DEFAULT_MAX_SYNTHETIC_PER_TARGET = 50;

/** Options for synthetic synapse generation. Issue #1924. */
export interface SyntheticSynapsesOptions {
  /**
   * Maximum synthetic connections per target neuron per layer pair.
   * When the number of available source neurons exceeds this limit,
   * evenly-spaced sampling selects a representative subset.
   * Default: 50.
   */
  maxPerTarget?: number;
}

/** Result of generating synthetic synapses. */
export interface SyntheticSynapsesResult {
  /** Number of synapses added to the creature. */
  addedCount: number;
  /** Set of "from-to" keys identifying which synapses are synthetic. */
  syntheticKeys: Set<string>;
  /**
   * Number of potential connections skipped due to per-target cap.
   * Zero when no capping was needed. Issue #1924.
   */
  skippedCount: number;
}

/**
 * Generate synthetic zero-weight synapses between neuron pairs in
 * adjacent layers.
 *
 * For each pair of adjacent layers (layer N and layer N+1), creates
 * zero-weight synapses from source neurons in layer N to target neurons
 * in layer N+1, skipping connections that already exist, constant neuron
 * targets, and frozen neuron targets.
 *
 * When a target neuron has more potential sources than `maxPerTarget`,
 * evenly-spaced sampling selects a deterministic subset ensuring good
 * coverage across the source layer. Issue #1924.
 *
 * @param creature The creature to add synthetic synapses to (modified in place)
 * @param options Optional configuration for generation limits
 * @returns The count of added synapses, tracking keys, and skipped count
 */
export function generateSyntheticSynapses(
  creature: Creature,
  options?: SyntheticSynapsesOptions,
): SyntheticSynapsesResult {
  const maxPerTarget = options?.maxPerTarget ??
    DEFAULT_MAX_SYNTHETIC_PER_TARGET;

  const layers = computeLayerAssignments(creature);
  const syntheticKeys = new Set<string>();
  let skippedCount = 0;

  // Sort layer numbers so we can iterate adjacent pairs.
  const layerNumbers = [...layers.keys()].sort((a, b) => a - b);

  if (layerNumbers.length < 2) {
    return { addedCount: 0, syntheticKeys, skippedCount: 0 };
  }

  // Pre-compute which neuron indices are invalid targets:
  // constant neurons, input neurons, frozen neurons, and aggregate neurons.
  // Aggregate neurons (IF, MAXIMUM, MINIMUM) have special structural
  // requirements (typed connections) and their applyLearnings can
  // disconnect connections and change squash types, so adding untyped
  // synthetic connections to them is architecturally unsound.
  const AGGREGATE_SQUASHES = new Set(["IF", "MAXIMUM", "MINIMUM"]);
  const skipTargets = new Set<number>();
  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type === "constant" || neuron.type === "input") {
      skipTargets.add(i);
    } else if (neuron.frozen) {
      skipTargets.add(i);
    } else if (neuron.squash && AGGREGATE_SQUASHES.has(neuron.squash)) {
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

    for (const toIdx of targetLayer) {
      // Skip invalid targets.
      if (skipTargets.has(toIdx)) continue;

      // Collect potential sources for this target neuron.
      const potentialSources: number[] = [];
      for (const fromIdx of sourceLayer) {
        // Skip if the connection already exists.
        if (creature.getSynapse(fromIdx, toIdx) !== null) continue;
        potentialSources.push(fromIdx);
      }

      // Apply per-target cap: if too many potential sources, sample
      // evenly across the source layer for good coverage. Issue #1924.
      let selectedSources: number[];
      if (
        maxPerTarget > 0 && potentialSources.length > maxPerTarget
      ) {
        const step = potentialSources.length / maxPerTarget;
        selectedSources = new Array(maxPerTarget);
        for (let s = 0; s < maxPerTarget; s++) {
          selectedSources[s] = potentialSources[Math.floor(s * step)];
        }
        skippedCount += potentialSources.length - maxPerTarget;
      } else {
        selectedSources = potentialSources;
      }

      for (const fromIdx of selectedSources) {
        const key = `${fromIdx}-${toIdx}`;
        syntheticKeys.add(key);
        connections.push({ from: fromIdx, to: toIdx, weight: 0 });
      }
    }
  }

  if (connections.length > 0) {
    creature.connectBatch(connections);
  }

  return { addedCount: connections.length, syntheticKeys, skippedCount };
}
