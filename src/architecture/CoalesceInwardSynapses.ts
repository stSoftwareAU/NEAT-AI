/**
 * @module
 *
 * Keep the inward synapses of one neuron obeying the `(from, to, type)`
 * identity rule (Issue #3873) after a pass has rewritten their roles.
 *
 * A role lives on the synapse row, so writing `synapse.type` in place moves
 * that row within its `(from, to)` run of the canonically-sorted
 * `creature.synapses` array — and, when the source already carries the role it
 * was given, collides with the row that was there. Issue #3880 saw both legs in
 * the field: `duplicate synapse …` and `synapses not sorted … type: condition
 * last type: negative`, from the same rewrite.
 *
 * Two rows that share an identity are exactly one row with the summed weight,
 * so the repair is to sum rather than to drop.
 */

import type { Creature } from "@creature";
import type { Synapse } from "@architecture/Synapse.ts";
import {
  compareSynapses,
  isRoleReadingTarget,
  synapseRoleRank,
} from "@architecture/SynapseKey.ts";
import { mergeTagsByNameValue } from "@utils/TagUtils.ts";
import { unifySynapseTypeForMerge } from "@utils/SynapseTypeUnify.ts";

/**
 * Sum the inward synapses of `indx` that share an identity into one row.
 *
 * Identity is `(from, to, type)` into an `IF` target — the only squash that
 * sums each role separately — and `(from, to)` into every other squash, which
 * sums its inward synapses regardless of role.
 *
 * The surviving row keeps its position, weight `Σ`, and the union of the merged
 * rows' tags. The array is re-sorted only when something was merged; a caller
 * that rewrote a role must ask for {@link normaliseInwardRoles} instead, since
 * the rewrite reorders rows even when nothing collides.
 *
 * @returns the number of rows removed.
 */
export function coalesceInwardDuplicates(
  creature: Creature,
  indx: number,
): number {
  const perRole = isRoleReadingTarget(creature.neurons, indx);
  const kept = new Map<string, Synapse>();
  const doomed = new Set<Synapse>();

  for (const synapse of creature.inwardConnections(indx)) {
    const key = perRole
      ? `${synapse.from}/${synapseRoleRank(synapse.type)}`
      : `${synapse.from}`;
    const first = kept.get(key);
    if (first === undefined) {
      kept.set(key, synapse);
      continue;
    }

    first.weight += synapse.weight;
    first.type = unifySynapseTypeForMerge(first.type, synapse.type);
    if (synapse.tags?.length) {
      first.tags = mergeTagsByNameValue(first.tags, synapse.tags);
    }
    doomed.add(synapse);
  }

  if (doomed.size === 0) return 0;

  creature.synapses = creature.synapses.filter((synapse) =>
    !doomed.has(synapse)
  );
  creature.synapses.sort(compareSynapses);
  creature.clearCache();
  return doomed.size;
}

/**
 * Restore the canonical shape of the inward synapses of `indx` after their
 * roles were rewritten (Issue #3880).
 *
 * The producer of the rewrite owns this: a role written in place leaves the
 * `(from, to)` run out of ascending role order, and can repeat a triple the
 * source already carried. Sorting and summing here means the next stage — a
 * `creatureValidate` three breeding attempts later, or the native scorer that
 * refuses the whole batch — never sees either.
 *
 * @returns the number of duplicate rows summed away.
 */
export function normaliseInwardRoles(
  creature: Creature,
  indx: number,
): number {
  const merged = coalesceInwardDuplicates(creature, indx);
  if (merged === 0) {
    // Nothing collided, but a rewritten role still moves its row within the
    // `(from, to)` run, so the canonical `(from, to, type)` order must be
    // restored regardless.
    creature.synapses.sort(compareSynapses);
    creature.clearCache();
  }
  return merged;
}
