/**
 * CreatureLineage.ts — in-memory parent lookup for evaluation-archive
 * provenance (Issues #3929, #4004).
 *
 * An archive record has to say which parents a scored creature came from, but
 * lineage is **run infrastructure and must not reach the creature export**: a
 * creature's `uuid` is a content hash, so anything persisted beside it that is
 * not content is a liability, and the export contract is fixed by the golden
 * fixtures.
 *
 * So lineage lives here instead, in a module-level `WeakMap` keyed on the
 * creature object. Nothing is serialised, nothing is hashed, and an offspring
 * dropped from the population is collectable the moment the population releases
 * it — the index is never the reason a generation is retained.
 *
 * ```mermaid
 * flowchart LR
 *   X[crossover breeding] -->|recordLineage child, mum, dad| W[(WeakMap)]
 *   F[fine-tune / compaction] -->|recordLineage candidate, fittest, previous| W
 *   C[creative-thinking clone] -->|recordLineage clone, elite| W
 *   M[mutate-a-clone] -->|recordDerivedFrom child, pre-mutation uuid| W
 *   K[clone before mutating] -->|inheritLineage clone, source| W
 *   W -->|lineageOf| A[archive record.parents]
 * ```
 *
 * @module CreatureLineage
 */

import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/** Offspring → the UUIDs of the parents it was bred from. */
const parentsByCreature = new WeakMap<Creature, readonly string[]>();

/** No parents known — one frozen array, so the empty case allocates nothing. */
const NO_PARENTS: readonly string[] = Object.freeze([]);

/**
 * Record the parents a creature was derived from.
 *
 * Issue #4004: each parent's UUID is **materialised** with
 * {@link CreatureUtil.makeUUID} rather than read off an optional field. A
 * parent whose content hash had not been computed yet used to be dropped
 * silently, which is how a two-parent record ended up naming one parent. The
 * materialised hash is the same one the archive keys that parent under, so the
 * link resolves.
 *
 * The call must therefore be made **while the parent still is the creature it
 * will be archived as** — never after it has been mutated in place. A
 * post-mutation hash would be a *wrong* link, which is worse than no link; for
 * the mutate-a-clone path use {@link recordDerivedFrom} with the UUID captured
 * before the mutation instead.
 *
 * Recording an empty parent set is a no-op, so a creature that was never
 * derived from another (a seed, a random immigrant) simply has no entry.
 *
 * @param child - The freshly derived creature.
 * @param parents - The creatures it was derived from, in any order.
 */
export function recordLineage(
  child: Creature,
  ...parents: readonly (Creature | undefined)[]
): void {
  const uuids: string[] = [];
  for (const parent of parents) {
    // An absent parent is a genuine gap in provenance and must read as one —
    // it is skipped rather than recorded as `"unknown"`.
    if (parent === undefined) continue;
    const uuid = CreatureUtil.makeUUID(parent);
    if (!uuids.includes(uuid)) uuids.push(uuid);
  }
  if (uuids.length === 0) return;
  parentsByCreature.set(child, Object.freeze(uuids));
}

/**
 * Record the single parent a creature was derived from, by UUID (Issue #4004).
 *
 * This is the mutate-a-clone path: a clone is mutated **in place**, so by the
 * time the offspring exists the parent object no longer holds the parent's
 * content. The caller captures the parent's UUID before mutating and names it
 * here.
 *
 * Any earlier record is replaced — naming the nearest ancestor is the point.
 * Deciding *whether* the pre-mutation identity is the nearest ancestor worth
 * naming belongs to the caller, which is the only place that knows whether that
 * identity was ever evaluated; see `Mutator.mutate`.
 *
 * @param child - The creature as it is after the mutation.
 * @param parentUuid - The UUID the creature carried before it was mutated.
 */
export function recordDerivedFrom(child: Creature, parentUuid: string): void {
  parentsByCreature.set(child, Object.freeze([parentUuid]));
}

/**
 * Carry a creature's recorded parents onto a clone of it (Issue #4004).
 *
 * Lineage is keyed on the creature **object**, so a clone starts with none even
 * though it is the same creature by content. Where the clone is then mutated
 * into something new — the de-duplicator's retry path — that loss matters: the
 * source may be a bred offspring that is about to be replaced and will never be
 * evaluated, so the only parents that resolve to an archive record are the ones
 * it inherited.
 *
 * A no-op when the source has no recorded parents.
 *
 * @param clone - The freshly cloned creature.
 * @param source - The creature it was cloned from.
 */
export function inheritLineage(clone: Creature, source: Creature): void {
  const parents = parentsByCreature.get(source);
  if (parents === undefined) return;
  parentsByCreature.set(clone, parents);
}

/**
 * The recorded parent UUIDs of `creature`.
 *
 * @param creature - The creature to look up.
 * @returns The parent UUIDs, or an empty array when none were recorded.
 */
export function lineageOf(creature: Creature): readonly string[] {
  return parentsByCreature.get(creature) ?? NO_PARENTS;
}
