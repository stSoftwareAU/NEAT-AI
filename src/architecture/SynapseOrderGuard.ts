import { TopologyError } from "@errors/TopologyError.ts";
import type { Creature } from "@creature";

/**
 * Debug-gated assertion that the synapse array is sorted lexicographically by
 * `(from, to)`.
 *
 * Issue #3083: `AddNeuron.insertNeuron` remaps every synapse coordinate
 * `>= index` with `f(x) = x + (x >= index ? 1 : 0)`. That map is strictly
 * monotonic increasing, so applying it to both `from` and `to` preserves the
 * existing `(from, to)` ordering — a previously-sorted array stays sorted
 * without an explicit re-sort. This assertion guards that invariant so any
 * future code path that disturbs the ordering is caught by tests rather than
 * silently mis-ordering connection lookups.
 *
 * The check only runs when `creature.DEBUG` is true, so it adds no cost to the
 * production hot path.
 *
 * @param creature The creature whose synapse ordering to verify
 * @param operation Human-readable name of the operation that just ran
 */
export function assertSynapsesSortedByFromTo(
  creature: Creature,
  operation: string,
): void {
  if (!creature.DEBUG) return;

  const synapses = creature.synapses;
  for (let i = 1; i < synapses.length; i++) {
    const prev = synapses[i - 1];
    const curr = synapses[i];
    const ordered = prev.from < curr.from ||
      (prev.from === curr.from && prev.to <= curr.to);
    if (!ordered) {
      throw new TopologyError(
        `[${operation}] Synapses out of order at index ${i}: ` +
          `[${prev.from}->${prev.to}] must not come before ` +
          `[${curr.from}->${curr.to}] (expected sort by (from, to))`,
        "INVALID_CONNECTION",
      );
    }
  }
}
