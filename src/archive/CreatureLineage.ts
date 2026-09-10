/**
 * CreatureLineage.ts — in-memory parent lookup for evaluation-archive
 * provenance (Issue #3929).
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
 * @module CreatureLineage
 */

import type { Creature } from "@creature";

/** Offspring → the UUIDs of the parents it was bred from. */
const parentsByCreature = new WeakMap<Creature, readonly string[]>();

/** No parents known — one frozen array, so the empty case allocates nothing. */
const NO_PARENTS: readonly string[] = Object.freeze([]);

/**
 * Record the parents an offspring was bred from.
 *
 * Parents without a UUID are skipped rather than recorded as `"unknown"`: a
 * missing parent is a gap in provenance and must read as one. Recording an
 * empty parent set is a no-op, so a creature that was never bred (an elite, a
 * random immigrant, a seed) simply has no entry.
 *
 * @param child - The freshly bred offspring.
 * @param parents - The creatures it was bred from, in any order.
 */
export function recordLineage(
  child: Creature,
  ...parents: readonly (Creature | undefined)[]
): void {
  const uuids: string[] = [];
  for (const parent of parents) {
    const uuid = parent?.uuid;
    if (uuid !== undefined) uuids.push(uuid);
  }
  if (uuids.length === 0) return;
  parentsByCreature.set(child, Object.freeze(uuids));
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
