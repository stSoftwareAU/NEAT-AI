/**
 * The guard the surrogate path must not run in production without — Issue
 * #3933.
 *
 * Three refusals and a detector, in one object:
 *
 * - the **mandatory uncertainty** of {@link ./UncertainSurrogate.ts}, which is
 *   structural in the type rather than enforced here;
 * - the **acquisition rule** of {@link ./ExactEvaluationAllocator.ts}, with
 *   its enforced and asserted uncertainty floor;
 * - the **refusal to extrapolate** of {@link ./CoverageRegion.ts}, which
 *   routes out-of-distribution candidates to exact evaluation; and
 * - the **signed-bias drift monitor** of {@link ./DriftMonitor.ts}, which
 *   disables the surrogate path the moment the model's mistakes stop being
 *   symmetric.
 *
 * It owns no model. A consumer fits whatever surrogate it likes, hands the
 * verdicts here, and gets back an allocation plus the three diagnostics the
 * issue asks every run to report: signed bias, uncertainty-allocation
 * fraction, and out-of-distribution rate.
 *
 * @module SurrogateGuard
 */

import type { RequiredSurrogateUncertaintyConfig } from "@config/SurrogateUncertaintyConfig.ts";
import {
  allocateExactEvaluations,
  type Allocation,
  assertUncertaintyFloor,
} from "@surrogate/ExactEvaluationAllocator.ts";
import {
  type DriftReading,
  SignedBiasDriftMonitor,
} from "@surrogate/DriftMonitor.ts";
import type { SurrogateVerdict } from "@surrogate/UncertainSurrogate.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** What the guard saw across a whole run. */
export interface SurrogateRunDiagnostics {
  /** Generations the guard allocated in. */
  readonly generations: number;
  /** Candidates the surrogate was asked about. */
  readonly candidates: number;
  /** Candidates it refused to predict. */
  readonly outOfDistribution: number;
  /** Those as a fraction of all candidates, in `[0, 1]`. */
  readonly outOfDistributionRate: number;
  /** Exact evaluations the guard allocated. */
  readonly exactSlots: number;
  /**
   * Exact evaluations the generation spent in total — the guard's own slots
   * plus the ones its caller had already handed out (the uniform survivor
   * draw of Issue #3932, which is exploration the guard did not choose).
   */
  readonly exactEvaluations: number;
  /** Of those, the ones spent where the model was unsure or had no data. */
  readonly explorationSlots: number;
  /**
   * `explorationSlots / exactSlots`, in `[0, 1]` — the share of the slots the
   * **acquisition rule allocated** that went where the model was unsure, and
   * the number the configured floor is asserted against. If it drifts to zero
   * the rule has degenerated to an argmax and the model has stopped being
   * corrected where it is wrong.
   */
  readonly uncertaintyFraction: number;
  /**
   * `explorationSlots / exactEvaluations`, in `[0, 1]` — the same exploration
   * measured against **every** exact evaluation the generation spent, slots
   * the caller had already handed out included. Always the smaller of the two,
   * and the honest answer to "what fraction of this run's true evaluations did
   * uncertainty buy?".
   */
  readonly explorationShare: number;
  /** Mean signed residual `predicted - exact` over the run, in score units. */
  readonly signedBias: number;
  /** Mean absolute residual over the run, in score units. */
  readonly meanAbsoluteResidual: number;
  /**
   * Bias ratio over the run's **pooled** residuals, or `null`. Not robust: one
   * creature scoring orders of magnitude below the rest drags it towards `±1`
   * however symmetric each generation was. Judge a run on
   * {@link SurrogateRunDiagnostics.generationBiasRatio}.
   */
  readonly biasRatio: number | null;
  /**
   * Mean of the per-generation bias ratios, or `null` — the reading the
   * escalation rule is built on, and the one to judge a run by.
   */
  readonly generationBiasRatio: number | null;
  /** Residuals the bias was taken over. */
  readonly residuals: number;
  /** True once the drift monitor disabled the surrogate path. */
  readonly disabled: boolean;
  /** The generation that happened in, or `null`. */
  readonly disabledAtGeneration: number | null;
}

/** Composes the acquisition rule, the drift monitor and the run diagnostics. */
export class SurrogateGuard {
  private readonly config: RequiredSurrogateUncertaintyConfig;
  private readonly monitor: SignedBiasDriftMonitor;
  private generations = 0;
  private candidates = 0;
  private outOfDistribution = 0;
  private exactSlots = 0;
  private externalSlots = 0;
  private explorationSlots = 0;
  private lastAllocation: Allocation | undefined;

  constructor(config: RequiredSurrogateUncertaintyConfig) {
    this.config = config;
    this.monitor = new SignedBiasDriftMonitor(config);
  }

  /** The configuration the guard was built with. */
  get settings(): RequiredSurrogateUncertaintyConfig {
    return this.config;
  }

  /**
   * True while the surrogate path may be consulted: the guard is configured on
   * and the drift monitor has not escalated.
   */
  get active(): boolean {
    return this.config.enabled && !this.monitor.escalated;
  }

  /** True once the drift monitor disabled the surrogate path. */
  get disabled(): boolean {
    return this.monitor.escalated;
  }

  /** The most recent allocation, or `undefined`. */
  get lastGeneration(): Allocation | undefined {
    return this.lastAllocation;
  }

  /** The three numbers every run reports. */
  get runDiagnostics(): SurrogateRunDiagnostics {
    return {
      generations: this.generations,
      candidates: this.candidates,
      outOfDistribution: this.outOfDistribution,
      outOfDistributionRate: this.candidates === 0
        ? 0
        : this.outOfDistribution / this.candidates,
      exactSlots: this.exactSlots,
      exactEvaluations: this.exactSlots + this.externalSlots,
      explorationSlots: this.explorationSlots,
      uncertaintyFraction: this.exactSlots === 0
        ? 0
        : this.explorationSlots / this.exactSlots,
      explorationShare: this.exactSlots + this.externalSlots === 0
        ? 0
        : this.explorationSlots / (this.exactSlots + this.externalSlots),
      signedBias: this.monitor.runSignedBias,
      meanAbsoluteResidual: this.monitor.runMeanAbsoluteResidual,
      biasRatio: this.monitor.runBiasRatio,
      generationBiasRatio: this.monitor.generationBiasRatio,
      residuals: this.monitor.runResiduals,
      disabled: this.monitor.escalated,
      disabledAtGeneration: this.monitor.escalatedGeneration,
    };
  }

  /**
   * Allocate this generation's exact evaluations over the surrogate's
   * verdicts.
   *
   * @param verdicts - One verdict per candidate, in candidate order.
   * @param slots - Exact evaluations available.
   * @param bestExactScore - Best exact score the run has seen.
   * @returns The allocation and its diagnostics.
   * @throws {SurrogateUncertaintyError} As {@link allocateExactEvaluations}.
   */
  allocate(
    verdicts: readonly SurrogateVerdict[],
    slots: number,
    bestExactScore: number,
  ): Allocation {
    const allocation = allocateExactEvaluations(
      verdicts,
      slots,
      bestExactScore,
      this.config,
    );
    const diagnostics = allocation.diagnostics;
    this.generations++;
    this.candidates += diagnostics.candidates;
    this.outOfDistribution += diagnostics.outOfDistribution;
    this.exactSlots += Math.min(diagnostics.slots, diagnostics.candidates);
    this.explorationSlots += diagnostics.outOfDistributionSlots +
      diagnostics.uncertaintySlots;
    this.lastAllocation = allocation;
    return allocation;
  }

  /**
   * Record exact evaluations the caller allocated itself, so the run's
   * exploration share is measured against every true evaluation the stage
   * spent rather than only the ones the acquisition rule handed out.
   *
   * @param slots - Exact evaluations spent outside the allocation, this
   *   generation. Negative or fractional counts are refused.
   * @throws {SurrogateUncertaintyError} `INVALID_ALLOCATION_REQUEST` when
   *   `slots` is not a non-negative whole number.
   */
  recordExternalExactEvaluations(slots: number): void {
    if (!Number.isSafeInteger(slots) || slots < 0) {
      throw new SurrogateUncertaintyError(
        `exact evaluations spent outside the allocation must be a ` +
          `non-negative whole number, got ${slots}`,
        "INVALID_ALLOCATION_REQUEST",
      );
    }
    this.externalSlots += slots;
  }

  /**
   * Record one prediction against the exact score that arrived for it.
   *
   * @param predicted - What the surrogate said.
   * @param exact - What the full evaluation returned.
   */
  observe(predicted: number, exact: number): void {
    this.monitor.record(predicted, exact);
  }

  /**
   * Close the generation: fold the residuals into a drift reading, and disable
   * the surrogate path if the bias has been one-directional for long enough.
   *
   * @param generation - The generation just finished.
   * @returns The reading.
   */
  closeGeneration(generation: number): DriftReading {
    return this.monitor.closeGeneration(generation);
  }

  /**
   * The drift line for the generation just closed, or `undefined` when it
   * carried no residuals.
   *
   * @param reading - The reading {@link closeGeneration} returned.
   * @returns The line, or `undefined` when the generation carried no
   *   residuals to report.
   */
  describeDrift(reading: DriftReading): string | undefined {
    return this.monitor.describe(reading);
  }

  /**
   * The per-generation allocation line.
   *
   * @returns The line, or `undefined` when nothing has been allocated yet.
   */
  describeAllocation(): string | undefined {
    const allocation = this.lastAllocation;
    if (allocation === undefined) return undefined;
    const d = allocation.diagnostics;
    return `[NEAT-AI] Surrogate acquisition (${d.rule}): ${d.slots} exact ` +
      `evaluation(s) over ${d.candidates} candidate(s) — ` +
      `${d.outOfDistributionSlots} out-of-distribution, ` +
      `${d.uncertaintySlots} on the uncertainty floor, ` +
      `${d.acquisitionSlots} by acquisition; OOD rate ` +
      `${(d.outOfDistributionRate * 100).toFixed(1)}%, uncertainty ` +
      `allocation ${(d.uncertaintyFraction * 100).toFixed(1)}% (floor ` +
      `${(d.floor * 100).toFixed(1)}%)`;
  }

  /**
   * The one line a run reports its guard diagnostics on.
   *
   * @returns The line: signed bias, uncertainty allocation, and OOD rate.
   */
  describeRun(): string {
    const d = this.runDiagnostics;
    const ratio = d.generationBiasRatio === null
      ? "undecidable"
      : d.generationBiasRatio.toFixed(3);
    return `[NEAT-AI] Surrogate guard over ${d.generations} generation(s): ` +
      `signed bias ${d.signedBias.toExponential(3)} (per-generation ratio ` +
      `${ratio}) over ${d.residuals} prediction(s), uncertainty allocation ` +
      `${(d.uncertaintyFraction * 100).toFixed(1)}% of ${d.exactSlots} ` +
      `allocated exact evaluation(s) — ` +
      `${(d.explorationShare * 100).toFixed(1)}% of all ` +
      `${d.exactEvaluations}, OOD rate ` +
      `${(d.outOfDistributionRate * 100).toFixed(1)}% of ${d.candidates} ` +
      `candidate(s)${
        d.disabled ? `, DISABLED at generation ${d.disabledAtGeneration}` : ""
      }`;
  }

  /**
   * Refuse a run whose realised uncertainty allocation fell below the floor.
   *
   * The per-allocation assertion catches one degenerate generation; this is
   * the run-level reading the issue asks to be asserted, and it is the one
   * that catches a floor honoured generation by generation and eroded in
   * aggregate. Same rule, applied to the run's totals.
   *
   * @throws {SurrogateUncertaintyError} `UNCERTAINTY_FLOOR_BREACHED` when the
   *   run spent less of its allocated exact evaluations on high-uncertainty
   *   candidates than the configured floor allows.
   */
  assertUncertaintyAllocation(): void {
    if (this.exactSlots === 0) return;
    const d = this.runDiagnostics;
    this.assertUncertaintyAllocationFor({
      candidates: d.candidates,
      exactSlots: d.exactSlots,
      explorationSlots: d.explorationSlots,
    });
  }

  /**
   * The same floor rule, applied to totals a caller supplies.
   *
   * A consumer that allocates some of its exact evaluations itself — the A/B
   * harness, a future policy that spends the budget differently — reports its
   * own totals here rather than publishing an uncertainty fraction nothing
   * checked.
   *
   * @param totals - Candidates considered, exact evaluations allocated, and
   *   how many of those went to refused or least-certain candidates.
   * @throws {SurrogateUncertaintyError} `UNCERTAINTY_FLOOR_BREACHED` when the
   *   exploration slots fall below the configured floor.
   */
  assertUncertaintyAllocationFor(
    totals: {
      readonly candidates: number;
      readonly exactSlots: number;
      readonly explorationSlots: number;
    },
  ): void {
    if (totals.exactSlots === 0) return;
    assertUncertaintyFloor({
      rule: this.config.acquisition,
      candidates: totals.candidates,
      slots: totals.exactSlots,
      outOfDistribution: 0,
      outOfDistributionRate: 0,
      // Which of the two exploration bands a slot came from is a
      // per-generation detail; the floor is asserted over their sum.
      outOfDistributionSlots: 0,
      uncertaintySlots: totals.explorationSlots,
      acquisitionSlots: totals.exactSlots - totals.explorationSlots,
      uncertaintyFraction: totals.explorationSlots / totals.exactSlots,
      floor: this.config.minUncertaintyFraction,
    });
  }

  /** Drop everything learnt. Call when starting a new run. */
  reset(): void {
    this.monitor.reset();
    this.generations = 0;
    this.candidates = 0;
    this.outOfDistribution = 0;
    this.exactSlots = 0;
    this.externalSlots = 0;
    this.explorationSlots = 0;
    this.lastAllocation = undefined;
  }
}
