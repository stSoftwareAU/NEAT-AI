import { TopologyError } from "@errors/TopologyError.ts";
import type { Creature } from "@creature";

/**
 * Rejects synapse endpoints that would make a forward-only creature recurrent.
 *
 * Call sites: {@link Creature.connect}, {@link Creature.connectBatch}, and
 * {@link loadFrom} so `forwardOnly === true` genomes cannot gain self-loops or
 * backward edges through the normal topology API (Issue #2086 follow-up).
 */
export function rejectRecurrentSynapseIfForwardOnlyCreature(
  topology: { forwardOnly?: boolean },
  from: number,
  to: number,
): void {
  if (topology.forwardOnly !== true) return;
  if (from === to) {
    throw new TopologyError(
      `Forward-only topology forbids self-connection ${from}->${to}`,
      "INVALID_CONNECTION",
    );
  }
  if (from > to) {
    throw new TopologyError(
      `Forward-only topology forbids backward connection ${from}->${to}`,
      "INVALID_CONNECTION",
    );
  }
}

/**
 * Debug-gated forward-only topology assertion for bulk index remapping
 * operations. Verifies all synapses still satisfy `from < to` after the
 * specified operation has modified synapse indices.
 *
 * Issue #2191: Bulk index remapping (insertNeuron, removeHiddenNeuron,
 * normaliseComputationalNeuronOrder, breeding) should preserve forward-only
 * ordering. This assertion catches violations early during development.
 *
 * @param creature The creature whose topology to verify
 * @param operation Human-readable name of the operation that just ran
 */
export function assertForwardOnlyTopologyAfterBulkRemap(
  creature: Creature,
  operation: string,
): void {
  if (!creature.DEBUG) return;
  if (!creature.forwardOnly) return;

  for (let i = 0; i < creature.synapses.length; i++) {
    const s = creature.synapses[i];
    if (s.from >= s.to) {
      throw new TopologyError(
        `[${operation}] Synapse ${i} violates forward-only topology after ` +
          `bulk index remap: from ${s.from} must be < to ${s.to}`,
        "INVALID_CONNECTION",
      );
    }
  }
}
