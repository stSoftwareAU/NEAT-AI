import type { Creature } from "@creature";
import { getLogger } from "@utils/Logger.ts";
import { cleanupOrphanedNeuronsInCreature } from "@compact/OrphanedNeuronCleanup.ts";

/**
 * Guard the compaction boundary so an invalid compact variant can never be
 * serialised into a training result (Issue #3383).
 *
 * The evolution worker packages the compacted creature as `train.compact` and
 * ships it back to the coordinator, which deserialises it in
 * `processCompletedResults` with full validation. A compaction sub-step can
 * intermittently strand a `constant` neuron with no outward connections (the
 * `NO_OUTWARD_CONNECTIONS` invariant), and because the worker-side compact load
 * runs with `validate: false`, that violation stays latent until the
 * coordinator's strict load throws — turning a repairable local fault into a
 * loud crash on the far side of the worker boundary.
 *
 * This helper closes that gap at the producer:
 * 1. Fast path — return the creature unchanged when it already validates.
 * 2. Prune any orphaned neurons the compaction stranded and re-validate.
 * 3. As a last resort run the full `fix()` repair and re-validate.
 * 4. If it still cannot be made valid, drop the compact variant (return
 *    `undefined`) so the trained creature is used instead — the compact form is
 *    only an optimisation candidate, never load-bearing — and log loudly so the
 *    latent producer bug is not silently swallowed.
 *
 * @param creature The compaction candidate to sanitise (repaired in place).
 * @returns The valid creature, or `undefined` when it cannot be repaired.
 */
export function sanitiseCompactVariant(
  creature: Creature,
): Creature | undefined {
  const options = creature.forwardOnly ? { forwardOnly: true } : undefined;

  // Fast path: already valid, no work to do.
  try {
    creature.validate(options);
    return creature;
  } catch {
    // Fall through to repair.
  }

  // Prune neurons the compaction stranded (e.g. a constant that lost its last
  // outward connection), then re-validate.
  cleanupOrphanedNeuronsInCreature(creature);
  try {
    creature.validate(options);
    return creature;
  } catch {
    // Fall through to the heavier repair.
  }

  // Last resort: full structural repair.
  try {
    creature.fix(options);
    creature.validate(options);
    return creature;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getLogger().warn(
      `🚨 [sanitiseCompactVariant] dropping invalid compact variant that ` +
        `could not be repaired (Issue #3383): ${message}`,
    );
    return undefined;
  }
}
