/**
 * @module
 *
 * Newborn grace period for structurally inserted neurons (Issue #3970).
 *
 * A neuron inserted by `AddNeuron` under a reduced `structuralWeightScale`
 * carries a near-identity outward weight, so its effect score in
 * {@link compactUnused} — `activation range × outward weight` — is close to
 * zero. That makes it the *first* neuron compaction removes, deleting the new
 * structure before the gradient step that was meant to give it a job.
 *
 * The grace budget travels with the neuron as a tag rather than as a config
 * value threaded through the training path, so it survives export/import and
 * is honoured in worker processes that never see the `NeatConfig`. Tags are
 * excluded from `CreatureUtil.makeUUID`, so tagging a newborn cannot change a
 * creature's identity.
 */
import { addTag, getTag, removeTag } from "@stsoftware/tags/mod";
import type { TagsInterface } from "@stsoftware/tags/mod";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

/** Tag holding the number of compaction passes a neuron is still exempt from. */
export const NEWBORN_GRACE_TAG = "newborn-grace";

/**
 * Marks a freshly inserted neuron as exempt from the next `rounds` compaction
 * passes. `rounds === 0` (the default) writes no tag at all, so behaviour is
 * bit-identical to a build without this feature.
 *
 * @param target - The newly inserted neuron.
 * @param rounds - Non-negative integer count of passes to protect it for.
 */
export function tagNewbornGrace(target: TagsInterface, rounds: number): void {
  if (!Number.isInteger(rounds) || rounds < 0) {
    throw new ConfigurationError(
      `Newborn grace rounds must be a non-negative integer, was ${rounds}`,
      Number.isInteger(rounds) ? "OUT_OF_RANGE" : "NOT_INTEGER",
    );
  }
  if (rounds === 0) return;
  addTag(target, NEWBORN_GRACE_TAG, String(rounds));
}

/**
 * Reads a neuron's remaining grace, in compaction passes.
 *
 * An absent, unparseable or negative tag reads as `0` — no protection — so a
 * damaged tag can never freeze a neuron in the creature permanently.
 *
 * @param target - Any tagged neuron shape (live neuron, export, or trace).
 * @returns Remaining protected passes, never negative.
 */
export function newbornGraceRemaining(target: TagsInterface): number {
  const raw = getTag(target, NEWBORN_GRACE_TAG);
  if (!raw) return 0;
  const remaining = Number.parseInt(raw, 10);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return remaining;
}

/**
 * Consumes one round of grace from every protected neuron in a creature,
 * removing the tag once it is exhausted.
 *
 * Called by {@link compactUnused} on each pass that actually compacted the
 * creature, so a newborn is protected for exactly the number of passes it was
 * given and is an ordinary removal candidate afterwards.
 *
 * @param creature - Any creature-shaped object with a `neurons` array.
 */
export function ageNewbornGrace(
  creature: { neurons: readonly TagsInterface[] },
): void {
  for (const neuron of creature.neurons) {
    const remaining = newbornGraceRemaining(neuron);
    if (remaining === 0) {
      // Strip a spent or malformed tag so it cannot accumulate.
      if (getTag(neuron, NEWBORN_GRACE_TAG)) {
        removeTag(neuron, NEWBORN_GRACE_TAG);
      }
      continue;
    }
    if (remaining === 1) {
      removeTag(neuron, NEWBORN_GRACE_TAG);
    } else {
      addTag(neuron, NEWBORN_GRACE_TAG, String(remaining - 1));
    }
  }
}
