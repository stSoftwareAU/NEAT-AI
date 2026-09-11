/**
 * Typed error for offspring pre-selection faults — Issue #3932.
 *
 * Pre-selection **discards** creatures, so every fault here is a case where a
 * candidate was about to be thrown away, or kept, on the strength of a number
 * that does not mean what the stage thinks it means. None of them may be
 * downgraded to a warning: a screen that silently returns nothing useful still
 * removes two thirds of a generation's offspring, and no fitness trace shows it
 * happening.
 *
 * @module PreSelectionError
 */

export type PreSelectionErrorReason =
  /**
   * A screen was configured that has no evaluator behind it in this build, so
   * asking for it would discard offspring on the strength of nothing.
   */
  | "NO_SCREEN_EVALUATOR"
  /**
   * A screen returned a value per candidate that cannot rank anything — the
   * wrong number of values, or a value that is not finite.
   */
  | "INVALID_SCREEN_VALUE"
  /**
   * A screen wrote to `Creature.score`. A screen value is not a fitness: it
   * decides what is worth measuring, and it must never be recorded as a
   * measurement.
   */
  | "SCREEN_WROTE_SCORE"
  /**
   * A `"surrogate"` screen was configured that cannot report an uncertainty
   * for its predictions (Issue #3933). A model family that cannot produce one
   * is not eligible: consumed without it, every exact evaluation lands where
   * the model is already confident and it is never corrected where it is
   * wrong.
   */
  | "SURROGATE_WITHOUT_UNCERTAINTY";

export class PreSelectionError extends Error {
  override readonly name = "PreSelectionError";
  readonly reason: PreSelectionErrorReason;

  constructor(message: string, reason: PreSelectionErrorReason) {
    super(message);
    this.reason = reason;
  }
}
