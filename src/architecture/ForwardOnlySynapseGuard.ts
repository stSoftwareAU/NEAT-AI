import { TopologyError } from "../errors/TopologyError.ts";

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
