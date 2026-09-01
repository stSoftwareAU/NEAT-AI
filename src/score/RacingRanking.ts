/**
 * Where abandoned creatures land in the breeding sort — Issue #3928.
 *
 * Scores do more than pick a winner: the population is **sorted by score for
 * breeding**, so an abandoned creature's partial error does not merely say
 * "not this one" — it also decides where that creature sits in the breeding
 * order. A partial-corpus error is not comparable with a full-corpus one
 * (it was measured over a different, order-dependent slice), so this module
 * states the rule explicitly instead of letting an incomparable number into
 * the same sort:
 *
 * > **Every abandoned creature ranks below every usably-scored creature**, and
 * > abandoned creatures are ordered among themselves by their partial error at
 * > abandonment (best partial error first).
 *
 * "Usably scored" means a **finite** full-corpus score. A fully-scored creature
 * whose scoring failed outright carries `-Infinity` (`Fitness` assigns it when
 * the scorer reports a non-finite error), and nothing can rank below that — so
 * the abandoned band sits between the finite scores and the failures. When
 * *every* fully-scored creature failed, the band collapses to `-Infinity` too
 * rather than becoming the top of a dead generation.
 *
 * The consequence is deliberate: an abandoned creature can never be the
 * generation's fittest, can never be selected as an elite, and can never be
 * exported. The policy guarantees that by never abandoning the leader and by
 * always leaving at least `minSurvivors` creatures racing to completion — set
 * from the run's `elitism`, so every elite slot can be filled from creatures
 * holding an exact score.
 *
 * @module RacingRanking
 */

import { addTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";

/**
 * Score gap between adjacent ranks in the abandoned band.
 *
 * Small enough that the band stays adjacent to the worst fully-scored creature
 * (so fitness-proportionate selection is not distorted by a fabricated
 * magnitude), and large enough to survive float rounding at production score
 * scales.
 */
export const RACING_ABANDON_RANK_GAP = 1e-6;

/** One creature the scorer abandoned mid-corpus. */
export interface AbandonedScore {
  readonly creature: Creature;
  /** Running mean error at the moment of abandonment. */
  readonly partialError: number;
  /** Records scored before abandonment. */
  readonly recordsScored: number;
  /** Records in the full corpus, for the diagnostic tag. */
  readonly corpusRecords: number;
}

/**
 * Assign every abandoned creature a score strictly below every fully-scored
 * creature in `population`, ordered among themselves by partial error.
 *
 * Called once per generation, after all scoring (batch and per-creature
 * worker path) has completed, so "fully scored" means what it says.
 *
 * @returns The scores assigned, in rank order (best abandoned first).
 */
export function rankAbandonedBelowScored(
  population: readonly Creature[],
  abandoned: readonly AbandonedScore[],
): number[] {
  if (abandoned.length === 0) return [];

  const abandonedSet = new Set(abandoned.map((a) => a.creature));
  let worstFullyScored = Infinity;
  for (const creature of population) {
    if (abandonedSet.has(creature)) continue;
    const score = creature.score;
    if (score === undefined || !Number.isFinite(score)) continue;
    if (score < worstFullyScored) worstFullyScored = score;
  }
  // Every fully-scored creature failed outright (`-Infinity`, the score
  // `Fitness` assigns when the scorer reports a non-finite error). There is no
  // rank band below `-Infinity`, so the only assignment that cannot put an
  // abandoned creature at the *top* of a dead generation is `-Infinity`
  // itself: the whole generation is then equally worthless, which is the truth.
  if (!Number.isFinite(worstFullyScored)) {
    for (const entry of abandoned) {
      entry.creature.score = -Infinity;
      addTag(entry.creature, "error", "Infinity");
      addTag(entry.creature, "score", "-Infinity");
      addTag(
        entry.creature,
        "racing",
        `abandoned ${entry.recordsScored}/${entry.corpusRecords}`,
      );
    }
    return abandoned.map(() => -Infinity);
  }
  const base = worstFullyScored;

  const ordered = [...abandoned].sort((a, b) => {
    const aError = Number.isFinite(a.partialError) ? a.partialError : Infinity;
    const bError = Number.isFinite(b.partialError) ? b.partialError : Infinity;
    if (aError !== bError) return aError - bError;
    // Stable, machine-independent tiebreak so a seeded run stays reproducible.
    return (a.creature.uuid ?? "").localeCompare(b.creature.uuid ?? "");
  });

  const assigned: number[] = [];
  ordered.forEach((entry, rank) => {
    const finite = Number.isFinite(entry.partialError);
    const score = finite
      ? base - RACING_ABANDON_RANK_GAP * (rank + 1)
      : -Infinity;
    entry.creature.score = score;
    addTag(
      entry.creature,
      "error",
      finite ? entry.partialError.toString() : "Infinity",
    );
    addTag(entry.creature, "score", score.toString());
    // The score above is a *rank*, not a measurement — the tag is how an
    // operator (or a downstream consumer reading tags) can tell.
    addTag(
      entry.creature,
      "racing",
      `abandoned ${entry.recordsScored}/${entry.corpusRecords}`,
    );
    assigned.push(score);
  });
  return assigned;
}
