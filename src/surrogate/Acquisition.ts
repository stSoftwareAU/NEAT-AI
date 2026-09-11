/**
 * The acquisition rules — Issue #3933.
 *
 * "Always evaluate the predicted best" is the policy that guarantees the model
 * is never corrected where it is wrong: the exact evaluations all land where
 * the model is already confident, so the regions it misjudges stay misjudged
 * for the rest of the run. Jones, Schonlau & Welch (1998) give the standard
 * remedy — score a candidate by what it could *gain*, not by what it is
 * *predicted* to be — and Jin (2011) §5 carries it into the evolutionary loop.
 *
 * Both rules here are stated in the literature for minimisation. NEAT-AI
 * scores are higher-is-better (`src/architecture/Fitness.ts` gives `-Infinity`
 * to a creature that could not be scored), so each is computed on its
 * maximisation mirror; the names are kept because they are what the literature
 * calls them.
 *
 * @module Acquisition
 */

import type { AcquisitionRule } from "@config/SurrogateUncertaintyConfig.ts";
import type { UncertainPrediction } from "@surrogate/UncertainSurrogate.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/**
 * Standard normal probability density.
 *
 * @param z - The standardised point.
 * @returns The density at `z`.
 */
export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal cumulative distribution.
 *
 * Abramowitz & Stegun 7.1.26 for `erf`, which is accurate to ~1.5e-7 — three
 * orders of magnitude finer than any difference an acquisition ordering turns
 * on, and it keeps the rule dependency-free and deterministic across engines.
 *
 * @param z - The standardised point.
 * @returns `P(Z <= z)`.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
            0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Expected improvement of a prediction over the best exact score so far.
 *
 * With `uncertainty === 0` the model claims it cannot be wrong, so the
 * expectation collapses to the improvement itself — `max(0, value - best)` —
 * rather than to a division by zero.
 *
 * @param prediction - The prediction, with its mandatory uncertainty.
 * @param best - Best **exact** score observed. Never a predicted one: EI
 *   measured against the model's own optimism is a rule with no ground truth
 *   in it, and it must be finite — against `-Infinity` every candidate
 *   improves without bound and the rule silently stops ordering anything.
 * @returns The expected improvement, always `>= 0`.
 * @throws {SurrogateUncertaintyError} `INVALID_ALLOCATION_REQUEST` when `best`
 *   is not finite. Ask for the confidence bound instead until the run has an
 *   incumbent to beat.
 */
export function expectedImprovement(
  prediction: UncertainPrediction,
  best: number,
): number {
  if (!Number.isFinite(best)) {
    throw new SurrogateUncertaintyError(
      `expected improvement was asked for against a best exact score of ` +
        `${best}: every candidate then improves without bound, and an ` +
        `acquisition rule that cannot order its candidates is an argmax on ` +
        `whatever order they arrived in`,
      "INVALID_ALLOCATION_REQUEST",
    );
  }
  const improvement = prediction.value - best;
  if (!(prediction.uncertainty > 0)) return Math.max(0, improvement);
  const z = improvement / prediction.uncertainty;
  return improvement * normalCdf(z) + prediction.uncertainty * normalPdf(z);
}

/**
 * The confidence-bound rule: the optimistic side of the prediction.
 *
 * @param prediction - The prediction, with its mandatory uncertainty.
 * @param kappa - Exploration weight; `0` reduces the rule to the argmax this
 *   whole module exists to replace.
 * @returns `value + kappa * uncertainty`.
 */
export function confidenceBound(
  prediction: UncertainPrediction,
  kappa: number,
): number {
  return prediction.value + kappa * prediction.uncertainty;
}

/**
 * Score a prediction by the configured rule.
 *
 * @param rule - Which rule to apply.
 * @param prediction - The prediction.
 * @param best - Best exact score so far, used by `"ei"`.
 * @param kappa - Exploration weight, used by `"lcb"`.
 * @returns The acquisition value; higher means "spend a true evaluation here".
 */
export function acquisitionValue(
  rule: AcquisitionRule,
  prediction: UncertainPrediction,
  best: number,
  kappa: number,
): number {
  switch (rule) {
    case "ei":
      return expectedImprovement(prediction, best);
    case "lcb":
      return confidenceBound(prediction, kappa);
  }
}
