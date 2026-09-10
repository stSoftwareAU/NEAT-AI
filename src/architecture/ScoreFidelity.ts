/**
 * Per-creature score fidelity — Issue #3931.
 *
 * A cheap score and an exact score are **different measurements**. Jin (2011)
 * §4's false-optimum failure mode begins the moment the two are treated as the
 * same number: an ordering that mixes them is meaningless, and a lineage that
 * accepts an approximate improvement proceeds from a false premise without
 * anything in the fitness trace showing it.
 *
 * This module is the mechanism that makes the difference visible — the tag a
 * creature carries saying how its score was measured — and nothing more. The
 * *policy* that decides which creature earns which fidelity is
 * [`EvolutionControl`](../NEAT/EvolutionControl.ts).
 *
 * ## Absent means exact, and that is not a silent default
 *
 * Every score NEAT-AI has ever produced outside the racing path (Issue #3928)
 * is a full-corpus evaluation, so an **untagged** creature is exact by
 * construction, and {@link scoreFidelity} says so by returning `null` rather
 * than a number — the caller sees "never approximated", not a fabricated `1`.
 * The tag is written only where a score was *not* exact, or to correct a stale
 * tag once an exact score replaces an approximate one. A default run therefore
 * carries no fidelity tag at all and its exported creatures are byte-identical
 * to those of every build before this one.
 *
 * @module ScoreFidelity
 */

import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { EvolutionControlError } from "@errors/EvolutionControlError.ts";

/** Tag key a creature's score fidelity is recorded under. */
export const SCORE_FIDELITY_TAG = "fidelity";

/** The fidelity of a full-corpus, ground-truth evaluation. */
export const EXACT_SCORE_FIDELITY = 1;

/**
 * Lowest fidelity that may be recorded.
 *
 * A creature abandoned before its first record still has *a* fidelity — it is
 * merely a terrible one — and `0` is reserved for "not measured at all", which
 * is a different statement.
 */
export const MIN_APPROXIMATE_FIDELITY = 1e-6;

/**
 * Highest fidelity an approximate score may be recorded at.
 *
 * Strictly below {@link EXACT_SCORE_FIDELITY}: a creature that scored the whole
 * corpus was never approximated, so rounding an almost-complete partial score
 * up to `1` would launder it into ground truth.
 */
export const MAX_APPROXIMATE_FIDELITY = 1 - 1e-9;

/**
 * Record the fidelity a creature's current score was measured at.
 *
 * @param creature - The creature holding the score.
 * @param fidelity - Fraction of the exact evaluation performed, in `(0, 1]`.
 * @throws {EvolutionControlError} `INVALID_FIDELITY` when out of range.
 */
export function markScoreFidelity(creature: Creature, fidelity: number): void {
  assertFidelityInRange(fidelity);
  addTag(creature, SCORE_FIDELITY_TAG, fidelity.toString());
}

/**
 * The fidelity a creature's score was measured at.
 *
 * @param creature - The creature to read.
 * @returns The recorded fidelity, or `null` when the creature was never
 *   approximated (see the module note — `null` is not `1`, it is "no
 *   approximation ever touched this score").
 * @throws {EvolutionControlError} `INVALID_FIDELITY` when the tag is present
 *   but not a number in `(0, 1]`. A corrupt fidelity is never read as exact.
 */
export function scoreFidelity(creature: Creature): number | null {
  const tag = getTag(creature, SCORE_FIDELITY_TAG);
  if (tag === null || tag === undefined) return null;
  const value = Number(tag);
  if (!Number.isFinite(value)) {
    throw new EvolutionControlError(
      `creature ${describe(creature)} carries an unreadable ` +
        `${SCORE_FIDELITY_TAG} tag ${JSON.stringify(tag)}`,
      "INVALID_FIDELITY",
    );
  }
  assertFidelityInRange(value);
  return value;
}

/**
 * Whether a creature's score is a full-corpus, ground-truth measurement.
 *
 * @param creature - The creature to test.
 * @returns `true` when never approximated, or approximated and since replaced
 *   by an exact evaluation.
 */
export function isExactScore(creature: Creature): boolean {
  const fidelity = scoreFidelity(creature);
  return fidelity === null || fidelity >= EXACT_SCORE_FIDELITY;
}

/**
 * Refuse to let an approximate score be used as ground truth.
 *
 * @param creature - The creature about to enter an exact-only slot.
 * @param context - What the creature was about to be used for, for the message.
 * @throws {EvolutionControlError} `APPROXIMATE_SCORE` when the score is cheap.
 */
export function assertExactScore(creature: Creature, context: string): void {
  const fidelity = scoreFidelity(creature);
  if (fidelity === null || fidelity >= EXACT_SCORE_FIDELITY) return;
  throw new EvolutionControlError(
    `${context}: creature ${describe(creature)} holds a score measured at ` +
      `fidelity ${fidelity}, and only an exact evaluation may be used here`,
    "APPROXIMATE_SCORE",
  );
}

/**
 * Promote a creature to exact **only if** it is already carrying a fidelity
 * tag, so a run that never approximated anything stays entirely untagged.
 *
 * Called from the exact scoring path: a creature abandoned in one generation
 * and fully scored in the next must not keep last generation's fidelity.
 *
 * @param creature - The creature that has just taken a full-corpus score.
 */
export function refreshExactScoreFidelity(creature: Creature): void {
  const tag = getTag(creature, SCORE_FIDELITY_TAG);
  if (tag === null || tag === undefined) return;
  addTag(creature, SCORE_FIDELITY_TAG, EXACT_SCORE_FIDELITY.toString());
}

/**
 * The fidelity of a score abandoned part-way through the corpus (Issue #3928).
 *
 * Held strictly inside `(0, 1)`: a partial score is never ground truth however
 * much of the corpus it covered, and it is never "not measured" either.
 *
 * @param recordsScored - Records scored before abandonment.
 * @param corpusRecords - Records in the full corpus.
 * @returns The fidelity to record, in `[MIN_APPROXIMATE_FIDELITY,
 *   MAX_APPROXIMATE_FIDELITY]`.
 */
export function partialCorpusFidelity(
  recordsScored: number,
  corpusRecords: number,
): number {
  const raw =
    Number.isFinite(recordsScored) && Number.isFinite(corpusRecords) &&
      corpusRecords > 0
      ? recordsScored / corpusRecords
      : 0;
  return Math.min(
    MAX_APPROXIMATE_FIDELITY,
    Math.max(MIN_APPROXIMATE_FIDELITY, raw),
  );
}

/** Reject a fidelity that is not a finite number inside `(0, 1]`. */
function assertFidelityInRange(fidelity: number): void {
  if (!Number.isFinite(fidelity) || fidelity <= 0 || fidelity > 1) {
    throw new EvolutionControlError(
      `score fidelity must be in (0, 1], got ${fidelity}`,
      "INVALID_FIDELITY",
    );
  }
}

/** A short, log-safe creature identity for an error message. */
function describe(creature: Creature): string {
  return creature.uuid ? creature.uuid.substring(0, 8) : "<no uuid>";
}
