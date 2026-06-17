import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/**
 * The two candidates produced by compaction (Issue #3037).
 *
 * - `safe`: all exact, behaviour-preserving folds. Its score is guaranteed to
 *   be ≥ the original creature's, so it is the floor that selection can never
 *   do worse than.
 * - `aggressive`: the safe folds plus extra structural pruning — a gamble that
 *   can never cost anything because `safe` is always available as the floor.
 *
 * Either field is absent when compaction produced no usable creature for that
 * variant. When the aggressive pass is a no-op (as in the #3037 plumbing) the
 * two are identical and dedupe via UUID rather than being scored twice.
 */
export type CompactVariants = {
  safe?: Creature;
  aggressive?: Creature;
};

/**
 * Pick the best single candidate from a {@link CompactVariants} pair for the
 * call sites that consume one compacted creature.
 *
 * The `safe` variant is the guaranteed floor, so it wins ties and is the
 * fallback whenever the aggressive variant is absent. The `aggressive` variant
 * only displaces it when it is a *distinct* creature (different UUID) with a
 * strictly higher finite score. When the two are identical — the no-op
 * placeholder of #3037 — the duplicate is never scored and `safe` is returned.
 */
export function selectCompactVariant(
  variants: CompactVariants,
): Creature | undefined {
  const { safe, aggressive } = variants;
  if (!aggressive) return safe;
  if (!safe) return aggressive;

  // Identical variants dedupe: keep the safe floor, never score the duplicate.
  if (CreatureUtil.makeUUID(safe) === CreatureUtil.makeUUID(aggressive)) {
    return safe;
  }

  const safeScore = safe.score;
  const aggressiveScore = aggressive.score;
  if (
    Number.isFinite(aggressiveScore) && Number.isFinite(safeScore) &&
    (aggressiveScore as number) > (safeScore as number)
  ) {
    return aggressive;
  }

  return safe;
}
