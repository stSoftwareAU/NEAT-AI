/**
 * MetropolisHastings.ts - Metropolis-Hastings acceptance criterion.
 *
 * Issue #2200: Implements the M-H acceptance step for MCMC-based
 * mutation acceptance. Improving mutations are always accepted;
 * worsening mutations are accepted with probability exp(-delta / T).
 *
 * This module also provides a lightweight weight/bias penalty proxy
 * that works directly on Creature objects without requiring a full
 * export, for use in the mutation pipeline.
 */

import type { Creature } from "@creature";
import { meanMagnitudePenalty } from "@architecture/Score.ts";
import {
  type AdvantageMode,
  type AdvantageOptions,
  normaliseDeltaWithCohortStd,
} from "@neat/GroupRelativeAdvantage.ts";
import { rankShapedDelta } from "@neat/RankShaping.ts";

/**
 * Determines whether a mutation should be accepted using the
 * Metropolis-Hastings criterion.
 *
 * @param deltaCost - The change in cost (positive = worsening, negative = improving)
 * @param temperature - The current MCMC temperature
 * @param randomValue - A random number in [0, 1) for deterministic testing
 * @returns true if the mutation should be accepted
 */
export function metropolisHastingsAccept(
  deltaCost: number,
  temperature: number,
  randomValue: number,
): boolean {
  // Improving or neutral mutations are always accepted
  if (deltaCost <= 0) {
    return true;
  }

  // At zero or near-zero temperature, reject all worsening mutations (greedy)
  if (temperature <= 0) {
    return false;
  }

  // Accept worsening mutations with probability exp(-deltaCost / temperature)
  const acceptanceProbability = Math.exp(-deltaCost / temperature);
  return randomValue < acceptanceProbability;
}

/** Extra inputs `resolveMcmcAcceptanceDelta` needs beyond the cohort std. */
export interface AcceptanceDeltaOptions extends AdvantageOptions {
  /**
   * Issue #3909: Recently observed raw deltas, used as the reference cohort
   * when `mode === "rankShaped"`. Ignored by the other modes; an empty or
   * missing reference makes every worsening proposal shape to `0.5`.
   */
  rankReference?: readonly number[];
}

/**
 * Resolves the effective acceptance delta given the configured
 * `mcmcAdvantageMode`.
 *
 * - `"absolute"` (default) returns `rawDelta` unchanged so the existing
 *   M-H behaviour is preserved bit-for-bit. The temperature is then in the
 *   **units of the cost function**, so it only means something relative to
 *   the current numeric spread of that cost.
 * - `"groupRelative"` (Issue #2527) returns `rawDelta / (cohortStd + eps)`
 *   clipped symmetrically into `[-clip, +clip]`, mirroring the DeepSeek V4
 *   GRPO advantage transform. The cohort std is supplied by the caller; when
 *   it is missing or zero (single-member cohort) the eps stabiliser keeps the
 *   result finite. The temperature is then in **cohort standard deviations**.
 * - `"rankShaped"` (Issue #3909) returns the proposal's quantile among
 *   recent worsening proposals, in `(0, 1)` — the Salimans et al. 2017 rank
 *   transform. The temperature is then in **quantile units** and means the
 *   same thing at every stage of a run, whatever the cost function's scale.
 *
 * @param rawDelta - The raw `post - pre` cost delta
 * @param mode - Acceptance signal mode from `MCMCConfig.mcmcAdvantageMode`
 * @param cohortStd - Cohort standard deviation; used by `"groupRelative"` only
 * @param options - Optional `eps`, `clip` and `rankReference` overrides
 */
export function resolveMcmcAcceptanceDelta(
  rawDelta: number,
  mode: AdvantageMode,
  cohortStd: number,
  options: AcceptanceDeltaOptions = {},
): number {
  if (mode === "absolute") return rawDelta;
  if (mode === "rankShaped") {
    return rankShapedDelta(rawDelta, options.rankReference ?? []);
  }
  return normaliseDeltaWithCohortStd(rawDelta, cohortStd, options);
}

/**
 * Computes a lightweight weight/bias penalty directly from a Creature, without
 * requiring a full JSON export, for the mutation pipeline.
 *
 * Charges the same aggregate the score charges — the mean per-value penalty
 * (Issue #3881). It previously averaged `(max, avg)`, which meant a mutation
 * that grew any weight other than the largest looked free to the M-H
 * acceptance test even after the score itself stopped treating it that way.
 *
 * Input neurons are skipped: their bias is Infinity by construction.
 *
 * @param creature - The creature to compute penalty for
 * @returns The weight/bias penalty in [0, 1) (lower is better)
 */
export function computeCreatureWeightBiasPenalty(creature: Creature): number {
  function* magnitudes(): Generator<number> {
    for (const synapse of creature.synapses) yield synapse.weight;
    for (let i = creature.input; i < creature.neurons.length; i++) {
      yield creature.neurons[i].bias;
    }
  }
  return meanMagnitudePenalty(magnitudes());
}

/**
 * Determines whether a mutation method name represents a topology mutation
 * (add/remove node or connection) as opposed to a weight/bias mutation.
 *
 * Topology mutations are always accepted unconditionally in M-H because
 * they are discrete structural changes that do not lend themselves to
 * continuous cost comparison.
 *
 * @param methodName - The mutation method name
 * @returns true if this is a topology mutation
 */
export function isTopologyMutation(methodName: string): boolean {
  switch (methodName) {
    case "ADD_NODE":
    case "SUB_NODE":
    case "ADD_CONN":
    case "SUB_CONN":
    case "ADD_SELF_CONN":
    case "SUB_SELF_CONN":
    case "ADD_BACK_CONN":
    case "SUB_BACK_CONN":
    case "SWAP_NODES":
    case "MOD_SQUASH":
      return true;
    default:
      return false;
  }
}
