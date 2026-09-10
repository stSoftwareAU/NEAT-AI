/**
 * Typed error for evolution-control invariant breaches — Issue #3931.
 *
 * Every fault here is a case where an **approximate** number was about to be
 * used as though it were ground truth. None of them is recoverable by
 * coercion, and none may be downgraded to a warning: Jin (2011) §4's
 * false-optimum failure mode is precisely a run that carried on happily while
 * an approximation stood in for the objective. A breach throws.
 *
 * @module EvolutionControlError
 */

export type EvolutionControlErrorReason =
  /** A creature holding an approximate score reached an exact-only slot. */
  | "APPROXIMATE_SCORE"
  /** An ordering was asked to compare a cheap score with an exact one. */
  | "MIXED_FIDELITY_COMPARISON"
  /** A fidelity outside `(0, 1]`, or a non-finite one, was offered. */
  | "INVALID_FIDELITY";

export class EvolutionControlError extends Error {
  override readonly name = "EvolutionControlError";
  readonly reason: EvolutionControlErrorReason;

  constructor(message: string, reason: EvolutionControlErrorReason) {
    super(message);
    this.reason = reason;
  }
}
