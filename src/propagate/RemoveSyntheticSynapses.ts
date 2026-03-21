/**
 * RemoveSyntheticSynapses.ts - Prune near-zero synthetic synapses after training.
 *
 * Issue #1922 - After backpropagation, removes synthetic synapses whose weights
 * remain near zero. Retains synthetic synapses that have been trained to
 * meaningful weights (these become permanent). Handles orphaned neurons that
 * result from the removal.
 *
 * Leverages existing:
 * - disconnectBatch() for efficient batch removal
 * - cleanupOrphanedNeuronsInCreature() for orphan handling (cascade-safe)
 * - pruneZeroWeightSynapses logic for output-neuron protection
 */

import type { Creature } from "../Creature.ts";
import { cleanupOrphanedNeuronsInCreature } from "../compact/OrphanedNeuronCleanup.ts";

/** Default threshold: same as the backpropagation plankConstant. */
const DEFAULT_THRESHOLD = 0.000_000_1;

/** Result of removing synthetic synapses. */
export interface RemoveSyntheticSynapsesResult {
  /** Number of synthetic synapses removed. */
  removed: number;
  /** Number of orphaned neurons removed entirely. */
  orphansRemoved: number;
  /** Number of orphaned hidden neurons converted to constants. */
  orphansConverted: number;
}

/**
 * Remove synthetic synapses whose weights remain near zero after training.
 *
 * Synthetic synapses that have been trained to non-trivial weights are
 * retained as permanent connections. After removal, any orphaned neurons
 * are cleaned up (converted to constant or removed entirely).
 *
 * Safety rules:
 * - Typed synapses (IF condition/positive/negative) are never removed
 * - Output neurons always retain at least one inward connection
 * - Cascade orphan removal is handled iteratively
 *
 * @param creature The creature to prune (modified in place)
 * @param syntheticKeys Set of "from-to" keys identifying synthetic synapses
 * @param threshold Maximum absolute weight to consider "near zero" (default: 1e-7)
 * @returns Counts of removed synapses and handled orphans
 */
export function removeSyntheticSynapses(
  creature: Creature,
  syntheticKeys: Set<string>,
  threshold: number = DEFAULT_THRESHOLD,
): RemoveSyntheticSynapsesResult {
  if (syntheticKeys.size === 0) {
    return { removed: 0, orphansRemoved: 0, orphansConverted: 0 };
  }

  // Build a set of output neuron indices for protection.
  const outputIndices = new Set<number>();
  for (let i = 0; i < creature.neurons.length; i++) {
    if (creature.neurons[i].type === "output") {
      outputIndices.add(i);
    }
  }

  // Count how many non-synthetic (or retained) inward connections each
  // output neuron will keep, so we can protect the last one.
  const outputInwardKept = new Map<number, number>();
  for (const outputIdx of outputIndices) {
    outputInwardKept.set(outputIdx, 0);
  }

  // First pass: count inward connections to outputs that will survive.
  for (const synapse of creature.synapses) {
    if (!outputIndices.has(synapse.to)) continue;

    const key = `${synapse.from}-${synapse.to}`;
    const isSynthetic = syntheticKeys.has(key);
    const isNearZero = Math.abs(synapse.weight) <= threshold;

    // This synapse survives if it's not synthetic, or if it's synthetic
    // but trained to a meaningful weight, or if it's typed.
    if (!isSynthetic || !isNearZero || synapse.type) {
      outputInwardKept.set(
        synapse.to,
        (outputInwardKept.get(synapse.to) ?? 0) + 1,
      );
    }
  }

  // Second pass: identify synthetic synapses to remove.
  const toDisconnect: Array<{ from: number; to: number }> = [];
  const preservedForOutput = new Set<number>();

  for (const synapse of creature.synapses) {
    const key = `${synapse.from}-${synapse.to}`;
    if (!syntheticKeys.has(key)) continue;

    // Never remove typed synapses (IF condition/positive/negative).
    if (synapse.type) continue;

    // Only remove near-zero weights.
    if (Math.abs(synapse.weight) > threshold) continue;

    // Protect last inward connection to output neurons.
    if (outputIndices.has(synapse.to)) {
      const kept = outputInwardKept.get(synapse.to) ?? 0;
      if (kept === 0 && !preservedForOutput.has(synapse.to)) {
        preservedForOutput.add(synapse.to);
        continue;
      }
    }

    toDisconnect.push({ from: synapse.from, to: synapse.to });
  }

  // Batch remove the identified synapses.
  if (toDisconnect.length > 0) {
    creature.disconnectBatch(toDisconnect);
  }

  // Run orphaned neuron cleanup (handles cascade removal).
  const orphanResult = cleanupOrphanedNeuronsInCreature(creature);

  return {
    removed: toDisconnect.length,
    orphansRemoved: orphanResult.removed,
    orphansConverted: orphanResult.converted,
  };
}
