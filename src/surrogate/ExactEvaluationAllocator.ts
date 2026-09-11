/**
 * Where the true evaluations go — Issue #3933.
 *
 * This is the issue's second refusal: **an acquisition rule, not an argmax.**
 * Ranking candidates by predicted score and evaluating the top of that ranking
 * is the one policy that guarantees the model is never corrected where it is
 * wrong, because every exact evaluation lands where the model is already
 * confident.
 *
 * The allocation runs in three bands, and the order matters:
 *
 * 1. **Out-of-distribution candidates first.** A refusal is not a low score —
 *    it is the model saying it has no data near this creature, and the only
 *    way to find out is to pay for it. In a NEAT population these are the
 *    novel topologies, which is to say the candidates that matter.
 * 2. **The uncertainty floor.** A stated minimum fraction of the slots goes to
 *    the candidates the model is least sure about, *regardless of predicted
 *    quality*. This is the band that costs apparent performance in the short
 *    run and is the reason the issue was filed separately.
 * 3. **The acquisition rule** fills what is left, by expected improvement or
 *    by the confidence bound.
 *
 * The floor is **enforced and then asserted**: if the realised fraction falls
 * below the configured one with candidates available to fill it, the allocator
 * throws rather than returning an allocation that has quietly degenerated to
 * an argmax.
 *
 * @module ExactEvaluationAllocator
 */

import type {
  AcquisitionRule,
  RequiredSurrogateUncertaintyConfig,
} from "@config/SurrogateUncertaintyConfig.ts";
import { acquisitionValue } from "@surrogate/Acquisition.ts";
import {
  isPrediction,
  type SurrogateVerdict,
} from "@surrogate/UncertainSurrogate.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** Why one candidate earned a true evaluation. */
export type AllocationReason =
  /** The model refused to predict it, so only a true evaluation can say. */
  | "out-of-distribution"
  /** Drawn by the uncertainty floor, whatever the model predicted. */
  | "uncertainty"
  /** Chosen by the acquisition rule. */
  | "acquisition";

/** One allocated slot. */
export interface AllocatedSlot {
  /** Index into the verdict array the allocation was asked about. */
  readonly index: number;
  /** Which band it came from. */
  readonly reason: AllocationReason;
  /**
   * The acquisition value it was ordered by, or `null` for a candidate the
   * model refused to predict — there is no acquisition value without a
   * prediction, and reporting `0` would read as "worthless".
   */
  readonly acquisition: number | null;
}

/** What one allocation spent, for the trace. */
export interface AllocationDiagnostics {
  readonly rule: AcquisitionRule;
  /** Candidates the allocation chose between. */
  readonly candidates: number;
  /** Slots there were to give. */
  readonly slots: number;
  /** Candidates the model refused to predict. */
  readonly outOfDistribution: number;
  /** Those candidates as a fraction of all candidates, in `[0, 1]`. */
  readonly outOfDistributionRate: number;
  /** Slots spent on out-of-distribution candidates. */
  readonly outOfDistributionSlots: number;
  /** Slots spent on the uncertainty floor. */
  readonly uncertaintySlots: number;
  /** Slots the acquisition rule filled. */
  readonly acquisitionSlots: number;
  /**
   * Exploration slots — out-of-distribution plus uncertainty floor — over the
   * slots there were, in `[0, 1]`. The number the configured floor is asserted
   * against.
   */
  readonly uncertaintyFraction: number;
  /** The floor this allocation was held to. */
  readonly floor: number;
}

/** What one allocation produced. */
export interface Allocation {
  /** The chosen slots, in the order they were allocated. */
  readonly slots: readonly AllocatedSlot[];
  readonly diagnostics: AllocationDiagnostics;
}

/**
 * Allocate `slots` true evaluations across candidates the surrogate has
 * judged.
 *
 * @param verdicts - One verdict per candidate, in candidate order.
 * @param slots - True evaluations available. `0` allocates nothing.
 * @param bestExactScore - Best **exact** score seen so far, for the `"ei"`
 *   rule. Must be finite when that rule is configured: a surrogate is only
 *   ever consulted after exact scores have arrived to fit it, so a run with
 *   no incumbent is a wiring fault rather than a state to paper over.
 * @param config - The resolved guard configuration.
 * @returns The allocation and its diagnostics.
 * @throws {SurrogateUncertaintyError} `INVALID_ALLOCATION_REQUEST` when
 *   `slots` is not a non-negative integer; `UNCERTAINTY_FLOOR_BREACHED` when
 *   the realised exploration fraction falls below the configured floor with
 *   candidates available to fill it.
 */
export function allocateExactEvaluations(
  verdicts: readonly SurrogateVerdict[],
  slots: number,
  bestExactScore: number,
  config: RequiredSurrogateUncertaintyConfig,
): Allocation {
  if (!Number.isSafeInteger(slots) || slots < 0) {
    throw new SurrogateUncertaintyError(
      `an allocation needs a non-negative whole number of slots, got ${slots}`,
      "INVALID_ALLOCATION_REQUEST",
    );
  }
  if (config.acquisition === "ei" && !Number.isFinite(bestExactScore)) {
    throw new SurrogateUncertaintyError(
      `the "ei" rule was asked to allocate ${slots} exact evaluation(s) ` +
        `against a best exact score of ${bestExactScore}: expected ` +
        `improvement has no incumbent to measure against, so the ordering ` +
        `would be an accident of candidate order`,
      "INVALID_ALLOCATION_REQUEST",
    );
  }
  const candidates = verdicts.length;
  const target = Math.min(slots, candidates);
  const oodIndices: number[] = [];
  const predicted: number[] = [];
  for (let i = 0; i < candidates; i++) {
    if (isPrediction(verdicts[i])) predicted.push(i);
    else oodIndices.push(i);
  }

  const chosen = new Set<number>();
  const allocated: AllocatedSlot[] = [];
  // Band 1: the refusals. Taken in candidate order so the same population
  // allocates the same way on a re-run.
  for (const index of oodIndices) {
    if (allocated.length >= target) break;
    chosen.add(index);
    allocated.push({ index, reason: "out-of-distribution", acquisition: null });
  }
  const outOfDistributionSlots = allocated.length;

  // Band 2: the floor, over the predictions only — an out-of-distribution
  // candidate has no uncertainty to rank by, and it is already spent on.
  const floorTarget = Math.ceil(config.minUncertaintyFraction * slots);
  const byUncertainty = [...predicted].sort((a, b) => {
    const left = verdicts[a];
    const right = verdicts[b];
    const leftSd = isPrediction(left) ? left.uncertainty : 0;
    const rightSd = isPrediction(right) ? right.uncertainty : 0;
    return rightSd - leftSd || a - b;
  });
  for (const index of byUncertainty) {
    if (allocated.length >= Math.min(target, floorTarget)) break;
    if (chosen.has(index)) continue;
    chosen.add(index);
    allocated.push({
      index,
      reason: "uncertainty",
      acquisition: scoreOf(verdicts[index], bestExactScore, config),
    });
  }
  const uncertaintySlots = allocated.length - outOfDistributionSlots;

  // Band 3: the acquisition rule fills the rest.
  const byAcquisition = [...predicted].sort((a, b) => {
    const left = scoreOf(verdicts[a], bestExactScore, config) ?? 0;
    const right = scoreOf(verdicts[b], bestExactScore, config) ?? 0;
    return right - left || a - b;
  });
  for (const index of byAcquisition) {
    if (allocated.length >= target) break;
    if (chosen.has(index)) continue;
    chosen.add(index);
    allocated.push({
      index,
      reason: "acquisition",
      acquisition: scoreOf(verdicts[index], bestExactScore, config),
    });
  }
  const acquisitionSlots = allocated.length - outOfDistributionSlots -
    uncertaintySlots;

  const explorationSlots = outOfDistributionSlots + uncertaintySlots;
  const diagnostics: AllocationDiagnostics = {
    rule: config.acquisition,
    candidates,
    slots,
    outOfDistribution: oodIndices.length,
    outOfDistributionRate: candidates === 0
      ? 0
      : oodIndices.length / candidates,
    outOfDistributionSlots,
    uncertaintySlots,
    acquisitionSlots,
    uncertaintyFraction: slots === 0 ? 0 : explorationSlots / slots,
    floor: config.minUncertaintyFraction,
  };
  assertUncertaintyFloor(diagnostics);
  return { slots: allocated, diagnostics };
}

/**
 * Refuse an allocation that spent less on uncertainty than it promised.
 *
 * The floor cannot always be met — a generation with four candidates and ten
 * slots has nothing left to explore with — so the assertion is against what
 * was **reachable**, not against the raw fraction. Anything short of that is
 * an acquisition rule that has degenerated to an argmax: invisible in a
 * fitness trace, and fatal to the model, because the exact evaluations then
 * all land where the model is already confident.
 *
 * Exported so a consumer that builds its own allocation — an A/B arm, a future
 * policy that spends the budget differently — is held to the same floor rather
 * than reporting one it never honoured.
 *
 * @param diagnostics - What an allocation spent.
 * @throws {SurrogateUncertaintyError} `UNCERTAINTY_FLOOR_BREACHED` when the
 *   exploration slots fall below the reachable floor.
 */
export function assertUncertaintyFloor(
  diagnostics: AllocationDiagnostics,
): void {
  const explorationSlots = diagnostics.outOfDistributionSlots +
    diagnostics.uncertaintySlots;
  const reachable = Math.min(diagnostics.slots, diagnostics.candidates);
  const required = Math.min(
    Math.ceil(diagnostics.floor * diagnostics.slots),
    reachable,
  );
  if (explorationSlots >= required) return;
  throw new SurrogateUncertaintyError(
    `the acquisition rule reserved ${explorationSlots} of ` +
      `${diagnostics.slots} exact evaluation(s) for high-uncertainty ` +
      `candidates, below the ${required} the configured floor of ` +
      `${diagnostics.floor} requires over ${diagnostics.candidates} ` +
      `candidate(s): an allocation that stops exploring is an argmax, and a ` +
      `model an argmax feeds is never corrected where it is wrong`,
    "UNCERTAINTY_FLOOR_BREACHED",
  );
}

/** The acquisition value of a verdict, or `null` when there is no prediction. */
function scoreOf(
  verdict: SurrogateVerdict,
  bestExactScore: number,
  config: RequiredSurrogateUncertaintyConfig,
): number | null {
  if (!isPrediction(verdict)) return null;
  return acquisitionValue(
    config.acquisition,
    verdict,
    bestExactScore,
    config.kappa,
  );
}
