/**
 * The surrogate interface that cannot hand back a bare number — Issue #3933.
 *
 * Jin (2011) §4–§5 returns repeatedly to one failure mode, and it is the
 * paper's most practical contribution: a surrogate does not merely make
 * mistakes, it makes **consistent** mistakes, and an evolutionary algorithm
 * finds and exploits them. The search converges to an optimum of the model
 * that is not an optimum of the objective — a **false optimum** — and the
 * fitness trace looks excellent throughout, because the fitness trace is drawn
 * from the model.
 *
 * The remedy starts here, in the shape of the type. A prediction is either:
 *
 * - a {@link UncertainPrediction} carrying a **mandatory** uncertainty, so a
 *   confident prediction and a wild extrapolation are distinguishable; or
 * - an {@link OutOfDistributionVerdict}, which is a **refusal**: the candidate
 *   sits outside the region the archive covers, and the honest answer is "I
 *   have no data near this", not a number.
 *
 * There is deliberately no third shape and no nullable field. A model family
 * that cannot produce an uncertainty — plain polynomial regression — either
 * gains one by bootstrap or ensemble variance, or is not eligible to implement
 * this interface. Making that structural is the point: it should be impossible
 * to consume a prediction without confronting its confidence.
 *
 * ```mermaid
 * flowchart LR
 *   C[candidate descriptor] --> M{covered by<br/>the archive?}
 *   M -->|no| O["out-of-distribution:<br/>refuse, route to exact evaluation"]
 *   M -->|yes| P["prediction:<br/>value + uncertainty"]
 *   P --> A[acquisition rule]
 *   O --> E[exact evaluation]
 *   A --> E
 * ```
 *
 * @module UncertainSurrogate
 */

import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** A point prediction and how sure the model is of it. */
export interface UncertainPrediction {
  readonly kind: "prediction";
  /** Predicted score, in score units. Higher is better. */
  readonly value: number;
  /**
   * One standard deviation of the model's own uncertainty, in score units.
   *
   * Never `null`, never optional, never negative. `0` is a real answer and a
   * strong claim — the model asserts it cannot be wrong about this candidate —
   * so it is reachable only where the training data genuinely says so.
   */
  readonly uncertainty: number;
}

/** The model's refusal to predict a candidate it has no data near. */
export interface OutOfDistributionVerdict {
  readonly kind: "out-of-distribution";
  /** Why the candidate fell outside, in one human-readable clause. */
  readonly reason: string;
  /** How far outside, in the units of {@link OutOfDistributionVerdict.limit}. */
  readonly distance: number;
  /** The limit that was breached. */
  readonly limit: number;
}

/** What a surrogate says about one candidate. */
export type SurrogateVerdict = UncertainPrediction | OutOfDistributionVerdict;

/**
 * A fitness approximation that reports its own confidence.
 *
 * Implementations are consulted before a true evaluation is allocated, never
 * to assign a fitness: a verdict is not a score and is never written to
 * `Creature.score`.
 */
export interface UncertainSurrogate {
  /** Which model this is, for the trace. */
  readonly name: string;
  /**
   * Predict the score of a creature with this descriptor.
   *
   * @param features - The structural descriptor (Issue #3929).
   * @returns A prediction with its uncertainty, or a refusal.
   */
  predict(features: readonly number[]): SurrogateVerdict;
}

/** True when a verdict carries a number rather than a refusal. */
export function isPrediction(
  verdict: SurrogateVerdict,
): verdict is UncertainPrediction {
  return verdict.kind === "prediction";
}

/**
 * Refuse a prediction that cannot be acted on.
 *
 * A `NaN` value ranks below everything and above nothing; a negative
 * uncertainty makes every acquisition rule here return a number with no
 * meaning. Both are caught at the boundary, where the model that produced them
 * can still be named.
 *
 * @param model - The model that produced the verdict, for the message.
 * @param verdict - The verdict to check.
 * @returns The same verdict, so this can wrap a return.
 * @throws {SurrogateUncertaintyError} `INVALID_PREDICTION` when the value is
 *   not finite, or the uncertainty is not a finite non-negative number.
 */
export function assertVerdict(
  model: string,
  verdict: SurrogateVerdict,
): SurrogateVerdict {
  if (verdict.kind === "out-of-distribution") return verdict;
  if (!Number.isFinite(verdict.value)) {
    throw new SurrogateUncertaintyError(
      `surrogate ${JSON.stringify(model)} predicted ${verdict.value}: a ` +
        `non-finite prediction cannot be ranked, and ranking on it silently ` +
        `is how a false optimum is reached`,
      "INVALID_PREDICTION",
    );
  }
  if (!Number.isFinite(verdict.uncertainty) || verdict.uncertainty < 0) {
    throw new SurrogateUncertaintyError(
      `surrogate ${JSON.stringify(model)} reported an uncertainty of ` +
        `${verdict.uncertainty} for a prediction of ${verdict.value}: the ` +
        `uncertainty is mandatory and must be a finite standard deviation ` +
        `>= 0`,
      "INVALID_PREDICTION",
    );
  }
  return verdict;
}
