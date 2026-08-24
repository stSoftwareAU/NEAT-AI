import { TopologyError } from "@errors/TopologyError.ts";
import type { Creature } from "@creature";
import { compareSynapses, synapseRoleLabel } from "@architecture/SynapseKey.ts";

/**
 * Debug-gated assertion that the synapse array is sorted lexicographically by
 * `(from, to, type)` (Issue #3873 — the role completes the key, so a source
 * feeding both branches of an `IF` still has a total order).
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
    if (compareSynapses(prev, curr) > 0) {
      throw new TopologyError(
        `[${operation}] Synapses out of order at index ${i}: ` +
          `[${prev.from}->${prev.to}/${
            synapseRoleLabel(prev.type)
          }] must not ` +
          `come before [${curr.from}->${curr.to}/${
            synapseRoleLabel(curr.type)
          }] (expected sort by (from, to, type))`,
        "INVALID_CONNECTION",
      );
    }
  }
}
