/**
 * RemoveSyntheticSynapses.ts - Prune near-zero synthetic synapses after training.
 *
 * Issue #1922 - After backpropagation, zeroes out synthetic synapses whose
 * weights remain near zero, then delegates to the standard compact function
 * for actual removal, orphan cleanup, and dead subgraph pruning (DRY).
 *
 * Retains synthetic synapses that have been trained to meaningful weights
 * (these become permanent connections).
 */

import type { Creature } from "@creature";

/** Default threshold: same as the backpropagation plankConstant. */
const DEFAULT_THRESHOLD = 0.000_000_1;

/** Result of removing synthetic synapses. */
export interface RemoveSyntheticSynapsesResult {
  /** Number of synthetic synapses zeroed (marked for removal by compact). */
  removed: number;
}

/**
 * Remove synthetic synapses whose weights remain near zero after training.
 *
 * Synthetic synapses that have been trained to non-trivial weights are
 * retained as permanent connections. Near-zero synthetic weights are set
 * to exactly zero, then the standard compact function handles the actual
 * removal, orphan cleanup, and structural tidying (DRY).
 *
 * Safety rules (enforced by compact):
 * - Typed synapses (IF condition/positive/negative) are never removed
 * - Output neurons always retain at least one inward connection
 * - Cascade orphan removal is handled iteratively
 *
 * @param creature The creature to prune (modified in place)
 * @param syntheticKeys Set of "from-to" keys identifying synthetic synapses
 * @param threshold Maximum absolute weight to consider "near zero" (default: 1e-7)
 * @returns Count of zeroed synapses
 */
export function removeSyntheticSynapses(
  creature: Creature,
  syntheticKeys: Set<string>,
  threshold: number = DEFAULT_THRESHOLD,
): RemoveSyntheticSynapsesResult {
  if (syntheticKeys.size === 0) {
    return { removed: 0 };
  }

  // Zero out near-zero synthetic synapse weights so that the standard
  // compact function will remove them along with any resulting orphans.
  let zeroed = 0;
  for (const synapse of creature.synapses) {
    const key = `${synapse.from}-${synapse.to}`;
    if (!syntheticKeys.has(key)) continue;

    // Never touch typed synapses (IF condition/positive/negative).
    if (synapse.type) continue;

    // Only zero near-zero weights; meaningful weights are retained.
    if (Math.abs(synapse.weight) > threshold) continue;

    synapse.weight = 0;
    zeroed++;
  }

  if (zeroed > 0) {
    // Delegate to the standard compact function for zero-weight synapse
    // removal, orphan cleanup, and dead subgraph pruning (DRY).
    const compacted = creature.compact(false);
    if (compacted) {
      creature.loadFrom(
        compacted.exportJSON(),
        false,
        "compact:removeSynthetic",
      );
    }
  }

  return { removed: zeroed };
}
