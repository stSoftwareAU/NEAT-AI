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
import { valuePenalty } from "@architecture/Score.ts";
import {
  type AdvantageMode,
  type AdvantageOptions,
  normaliseDeltaWithCohortStd,
} from "@neat/GroupRelativeAdvantage.ts";

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

/**
 * Issue #2527: Resolves the effective acceptance delta given the
 * configured `mcmcAdvantageMode`.
 *
 * - `"absolute"` (default) returns `rawDelta` unchanged so the existing
 *   M-H behaviour is preserved bit-for-bit.
 * - `"groupRelative"` returns `rawDelta / (cohortStd + eps)` clipped
 *   symmetrically into `[-clip, +clip]`, mirroring the DeepSeek V4 GRPO
 *   advantage transform. The cohort std is supplied by the caller; when
 *   it is missing or zero (single-member cohort) the eps stabiliser
 *   keeps the result finite.
 *
 * @param rawDelta - The raw `post - pre` cost delta
 * @param mode - Acceptance signal mode from `MCMCConfig.mcmcAdvantageMode`
 * @param cohortStd - Cohort standard deviation; ignored in `"absolute"` mode
 * @param options - Optional `eps` and `clip` overrides
 */
export function resolveMcmcAcceptanceDelta(
  rawDelta: number,
  mode: AdvantageMode,
  cohortStd: number,
  options: AdvantageOptions = {},
): number {
  if (mode === "absolute") return rawDelta;
  return normaliseDeltaWithCohortStd(rawDelta, cohortStd, options);
}

/**
 * Computes a lightweight weight/bias penalty directly from a Creature,
 * without requiring a full JSON export. This mirrors the logic in
 * CompactCreature.ts calculateWeightBiasPenalty() but operates on
 * live Creature objects for efficiency in the mutation pipeline.
 *
 * @param creature - The creature to compute penalty for
 * @returns The weight/bias penalty (lower is better)
 */
export function computeCreatureWeightBiasPenalty(creature: Creature): number {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const synapse of creature.synapses) {
    const w = Math.abs(synapse.weight);
    if (!Number.isFinite(w)) continue;
    max = Math.max(max, w);
    total += w;
    count++;
  }

  // Skip input neurons (they have Infinity bias)
  for (let i = creature.input; i < creature.neurons.length; i++) {
    const b = Math.abs(creature.neurons[i].bias);
    if (!Number.isFinite(b)) continue;
    max = Math.max(max, b);
    total += b;
    count++;
  }

  if (count === 0) return 0;

  // Clamp to avoid tripping valuePenalty() asserts on absurd magnitudes.
  if (max > Number.MAX_SAFE_INTEGER) max = Number.MAX_SAFE_INTEGER;
  if (total > Number.MAX_SAFE_INTEGER) total = Number.MAX_SAFE_INTEGER;

  const avg = total / count;
  return (valuePenalty(max) + valuePenalty(avg)) / 2;
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
