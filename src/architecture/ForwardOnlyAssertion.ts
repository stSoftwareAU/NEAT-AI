/**
 * Forward-only assertion helper (Issue #2500).
 *
 * Centralises the check that no recurrent synapse (`from >= to`) appears
 * on a creature flagged `forwardOnly === true`. Pipelines that produce
 * structures (mutation, breeding, discovery, coordinated structural
 * application) should call this helper at the corruption introduction
 * point so failures are caught **before** the creature reaches
 * `loadFrom`, where the synapse is silently stripped.
 */
import type { Creature } from "@creature";
import { TopologyError } from "@errors/TopologyError.ts";

/**
 * Throws a {@link TopologyError} when `creature.forwardOnly === true`
 * and any synapse violates `from < to`.
 *
 * @param creature The creature to check.
 * @param source Short tag identifying the calling pipeline. Included in
 *   the thrown error message so the upstream stack frame can be
 *   identified from the message alone (e.g. logs, replays).
 */
export function assertNoRecurrentSynapseOnForwardOnly(
  creature: Creature,
  source: string,
): void {
  if (creature.forwardOnly !== true) return;
  const synapses = creature.synapses;
  if (!synapses || synapses.length === 0) return;
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    if (s.from >= s.to) {
      throw new TopologyError(
        `[${source}] Forward-only creature ${
          creature.uuid ?? "(no-uuid)"
        } has recurrent synapse at index ${i}: ${s.from}->${s.to}. ` +
          `This is the upstream corruption that produces ` +
          `'[loadFrom] Stripping recurrent synapse' warnings (Issue #2500).`,
        "INVALID_CONNECTION",
      );
    }
  }
}
