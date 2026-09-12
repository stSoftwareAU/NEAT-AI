/**
 * Evolution control — the model-management policy of Jin (2011) §4.
 *
 * Issue #3931. A cheap fitness evaluator is the easy half of surrogate-assisted
 * evolution. The hard half is the **policy**: which individuals earn the true
 * fitness, which get the approximation, and how that split adapts as the search
 * proceeds. Before this module NEAT-AI had exactly one fitness policy and it
 * was implicit — `src/architecture/Fitness.ts` evaluates every creature
 * exactly, every generation — so no object owned the question *is this creature
 * worth an exact evaluation?*
 *
 * This is that object. It sits beside the other per-generation policy objects
 * ({@link ./AdaptivePopulationSizer.ts}, {@link ./PlateauDetector.ts},
 * {@link ./BreedingQuotas.ts}) rather than inside `Fitness`, which stays a
 * mechanism.
 *
 * ```mermaid
 * flowchart TD
 *   G[generation starts] --> P{strategy}
 *   P -->|none| E[exact sweep: every creature]
 *   P -->|generation| L{generation % exactEvery == 0<br/>or first generation}
 *   P -->|individual| K[cheap sweep, then exact for<br/>elites + top-k + spread]
 *   L -->|yes| E
 *   L -->|no| C[cheap sweep]
 *   E --> A[canary: compare the cheap ordering<br/>with the exact one]
 *   K --> A
 *   A -->|divergence over threshold<br/>or widening across the window| X[escalate:<br/>exact for the rest of the run]
 *   A -->|within bounds| G
 *   C --> G
 * ```
 *
 * ## The invariants, none of which are optional
 *
 * - **Elites and `previousFittest` are always exact.** `NeatEvolution` asserts
 *   `previousFittest.score <= tmpFittest.score`; feeding that an approximate
 *   score either trips it spuriously or, far worse, satisfies it with a
 *   creature that is not actually an improvement.
 * - **Never compare across fidelities.** {@link EvolutionControl.compareScores}
 *   refuses a mixed comparison rather than tolerating one.
 * - **Exported creatures carry an exact score.**
 * - **Every generation logs its fidelity and its exact-evaluation count**, so a
 *   run's trace can be read after the fact.
 *
 * See [`docs/EVOLUTION_CONTROL.md`](../../docs/EVOLUTION_CONTROL.md).
 *
 * @module EvolutionControl
 */

import type { Creature } from "@creature";
import {
  assertExactScore,
  EXACT_SCORE_FIDELITY,
  isExactScore,
  markScoreFidelity,
  scoreFidelity,
} from "@architecture/ScoreFidelity.ts";
import { EvolutionControlError } from "@errors/EvolutionControlError.ts";
import type {
  EvolutionControlStrategy,
  RequiredEvolutionControlConfig,
} from "@config/EvolutionControlConfig.ts";
import { DEFAULT_EVOLUTION_CONTROL_CONFIG } from "@config/EvolutionControlConfig.ts";

/** What a whole generation's sweep costs. */
export type GenerationFidelity = "exact" | "approximate";

/** Why the policy chose the fidelity it chose, for the per-generation log. */
export type EvolutionControlReason =
  /** `strategy: "none"` — the policy is off and everything is exact. */
  | "strategy-off"
  /** The first generation of a run always anchors on ground truth. */
  | "first-generation"
  /** A scheduled exact sweep (generation-based control). */
  | "scheduled-anchor"
  /** A cheap sweep with an exact subset (individual-based control). */
  | "individual-subset"
  /** A cheap sweep between anchors. */
  | "between-anchors"
  /** The false-optimum canary tripped; the cheap path is abandoned. */
  | "canary-escalated";

/** The fidelity decision for one generation. */
export interface GenerationPlan {
  readonly generation: number;
  readonly strategy: EvolutionControlStrategy;
  /** `"exact"` when every creature in the sweep earns a true evaluation. */
  readonly fidelity: GenerationFidelity;
  /** True when no creature in this generation may hold a cheap score. */
  readonly exactSweep: boolean;
  readonly reason: EvolutionControlReason;
}

/** One anchor's reading of how far the cheap ordering drifted. */
export interface CanaryReading {
  readonly generation: number;
  /**
   * Fraction of creature pairs the cheap ordering placed the other way round
   * from the exact one, in `[0, 1]`; `null` when there were too few pairs to
   * decide. An undecidable reading is never a pass — it is simply not recorded.
   */
  readonly divergence: number | null;
  /** Pairs the reading was taken over. */
  readonly pairs: number;
  /** True when divergence rose at every anchor across the canary window. */
  readonly widening: boolean;
  /** True once the cheap path has been abandoned for the rest of the run. */
  readonly escalated: boolean;
}

/** What one generation actually cost, for the trace. */
export interface GenerationSummary {
  readonly generation: number;
  readonly strategy: EvolutionControlStrategy;
  readonly fidelity: GenerationFidelity;
  readonly reason: EvolutionControlReason;
  readonly exactEvaluations: number;
  readonly approximateEvaluations: number;
  readonly divergence: number | null;
  readonly escalated: boolean;
}

/**
 * Fraction of pairs two orderings disagree on — the false-optimum canary.
 *
 * A **one-sided tie** counts as a disagreement: a predictor that gives two
 * creatures the same score when the exact evaluation separates them has failed
 * to order them, and Issue #3927 measured exactly that failure at every
 * sampling rate it tried. Ties are not free. A pair the *exact* evaluation also
 * ties is not a disagreement — there was no ordering to get wrong.
 *
 * @param approximate - Cheap scores, one per creature.
 * @param exact - Exact scores for the same creatures, in the same order.
 * @returns The discordant-pair fraction in `[0, 1]`, or `null` when fewer than
 *   two creatures were supplied and no ordering exists to compare.
 * @throws {EvolutionControlError} When the two arrays are different lengths —
 *   a divergence computed over misaligned scores is a number with no meaning.
 */
export function orderingDivergence(
  approximate: readonly number[],
  exact: readonly number[],
): number | null {
  if (approximate.length !== exact.length) {
    throw new EvolutionControlError(
      `ordering divergence needs one exact score per approximate score, got ` +
        `${approximate.length} and ${exact.length}`,
      "MIXED_FIDELITY_COMPARISON",
    );
  }
  const n = approximate.length;
  if (n < 2) return null;

  let discordant = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs++;
      if (
        Math.sign(approximate[i] - approximate[j]) !==
          Math.sign(exact[i] - exact[j])
      ) {
        discordant++;
      }
    }
  }
  return discordant / pairs;
}

/**
 * The per-generation fidelity decision, and the guards that keep an
 * approximate score out of every slot that must hold ground truth.
 *
 * @example
 * ```ts
 * const control = new EvolutionControl({
 *   ...DEFAULT_EVOLUTION_CONTROL_CONFIG,
 *   strategy: "generation",
 *   exactEvery: 5,
 * });
 *
 * const plan = control.beginGeneration(generation);
 * // ... evaluate the population at `plan.fidelity` ...
 * control.assertExactAll(elitists, "elitism");
 * getLogger().info(control.describe(control.summarise(population)));
 * ```
 */
export class EvolutionControl {
  private readonly config: RequiredEvolutionControlConfig;
  private currentPlan: GenerationPlan;
  private divergenceHistory: number[] = [];
  private lastReading: CanaryReading | undefined;
  private escalatedAt: number | undefined;
  private reportedUnhonouredPlan = false;

  /**
   * @param config - Fully resolved configuration; defaults leave the policy off.
   */
  constructor(
    config: RequiredEvolutionControlConfig = DEFAULT_EVOLUTION_CONTROL_CONFIG,
  ) {
    this.config = config;
    this.currentPlan = offPlan(0, config.strategy);
  }

  /** The configured strategy. */
  get strategy(): EvolutionControlStrategy {
    return this.config.strategy;
  }

  /** True when a strategy other than `"none"` is running. */
  get active(): boolean {
    return this.config.strategy !== "none";
  }

  /** True once the canary has abandoned the cheap path for this run. */
  get escalated(): boolean {
    return this.escalatedAt !== undefined;
  }

  /** The generation the canary escalated on, or `undefined`. */
  get escalatedGeneration(): number | undefined {
    return this.escalatedAt;
  }

  /** The plan for the generation currently running. */
  get plan(): GenerationPlan {
    return this.currentPlan;
  }

  /** The most recent canary reading, or `undefined` before the first anchor. */
  get lastCanaryReading(): CanaryReading | undefined {
    return this.lastReading;
  }

  /**
   * Decide this generation's fidelity.
   *
   * @param generation - The generation about to run, counting from 1.
   * @returns The plan, which is also available afterwards as {@link plan}.
   */
  beginGeneration(generation: number): GenerationPlan {
    this.currentPlan = this.decide(generation);
    return this.currentPlan;
  }

  /** Choose the fidelity for `generation` without recording it. */
  private decide(generation: number): GenerationPlan {
    const strategy = this.config.strategy;
    if (strategy === "none") return offPlan(generation, strategy);
    if (this.escalated) {
      return {
        generation,
        strategy,
        fidelity: "exact",
        exactSweep: true,
        reason: "canary-escalated",
      };
    }
    // The first generation has nothing to anchor against, so it is exact
    // whatever the strategy: a run that starts on an approximation has no
    // ground truth to measure the approximation's drift from.
    if (generation <= 1) {
      return {
        generation,
        strategy,
        fidelity: "exact",
        exactSweep: true,
        reason: "first-generation",
      };
    }
    if (strategy === "generation") {
      const anchor = generation % this.config.exactEvery === 0;
      return {
        generation,
        strategy,
        fidelity: anchor ? "exact" : "approximate",
        exactSweep: anchor,
        reason: anchor ? "scheduled-anchor" : "between-anchors",
      };
    }
    // Individual-based control: the sweep is cheap, and a subset named by
    // `selectExactCandidates` is re-evaluated exactly on top of it.
    return {
      generation,
      strategy,
      fidelity: "approximate",
      exactSweep: false,
      reason: "individual-subset",
    };
  }

  /**
   * Individual-based control: which creatures earn an exact re-evaluation.
   *
   * Jin (2011) §4 names two groups, and this returns both: the
   * **best-predicted** individuals — where an ordering error costs the most —
   * and a **spread** drawn across the rest of the cheap ordering, so drift is
   * measured somewhere other than the top of the population. The spread is
   * taken on a fixed stride rather than at random, so a same-seed A/B is
   * reproducible.
   *
   * Generic over anything carrying a `score`, so the same selection arithmetic
   * can be measured directly by the Issue #3931 A/B harness rather than
   * re-implemented there.
   *
   * @param population - The cheaply-scored population.
   * @param guaranteed - Creatures that must be exact whatever their rank
   *   (the elites, and `previousFittest`).
   * @returns The creatures to re-evaluate exactly, best-predicted first, with
   *   `guaranteed` members ahead of them. Never contains duplicates.
   */
  selectExactCandidates<T extends { score?: number }>(
    population: readonly T[],
    guaranteed: readonly T[] = [],
  ): T[] {
    const chosen: T[] = [];
    const seen = new Set<T>();
    const take = (creature: T | undefined) => {
      if (creature === undefined || seen.has(creature)) return;
      seen.add(creature);
      chosen.push(creature);
    };

    for (const creature of guaranteed) take(creature);
    if (this.config.strategy !== "individual") return chosen;

    const ranked = rankByScore(population);
    const topK = Math.min(this.config.exactTopK, ranked.length);
    for (let i = 0; i < topK; i++) take(ranked[i]);

    const remainder = ranked.slice(topK);
    const sample = Math.min(this.config.diverseSampleSize, remainder.length);
    if (sample > 0) {
      // Even stride across the remainder, sampled at the centre of each band so
      // the draw is not biased towards either end of the ordering.
      const stride = remainder.length / sample;
      for (let i = 0; i < sample; i++) {
        const index = Math.min(
          remainder.length - 1,
          Math.floor(stride * i + stride / 2),
        );
        take(remainder[index]);
      }
    }
    return chosen;
  }

  /**
   * Record the fidelity a creature's score was measured at.
   *
   * @param creature - The creature holding the score.
   * @param fidelity - Fraction of the exact evaluation performed, in `(0, 1]`.
   * @throws {EvolutionControlError} `INVALID_FIDELITY` when out of range.
   */
  markFidelity(creature: Creature, fidelity: number): void {
    markScoreFidelity(creature, fidelity);
  }

  /**
   * The fidelity a creature's score was measured at, or `null` when it was
   * never approximated.
   *
   * @param creature - The creature to read.
   */
  fidelityOf(creature: Creature): number | null {
    return scoreFidelity(creature);
  }

  /**
   * Refuse to let an approximate score be used as ground truth.
   *
   * @param creature - The creature entering an exact-only slot.
   * @param context - What it was about to be used for.
   * @throws {EvolutionControlError} `APPROXIMATE_SCORE` when the score is cheap.
   */
  assertExact(creature: Creature, context: string): void {
    assertExactScore(creature, context);
  }

  /**
   * Refuse an approximate score anywhere in a group — the elite band, say.
   *
   * @param creatures - The creatures entering exact-only slots.
   * @param context - What they were about to be used for.
   * @throws {EvolutionControlError} `APPROXIMATE_SCORE` on the first offender.
   */
  assertExactAll(creatures: readonly Creature[], context: string): void {
    for (const creature of creatures) {
      assertExactScore(creature, context);
    }
  }

  /**
   * Compare two creatures by score, best first — refusing a mixed comparison.
   *
   * @param a - One creature.
   * @param b - The other.
   * @returns Negative when `a` is fitter, positive when `b` is, `0` on a tie.
   * @throws {EvolutionControlError} `MIXED_FIDELITY_COMPARISON` when the two
   *   scores were measured at different fidelities, or either is unscored.
   */
  compareScores(a: Creature, b: Creature): number {
    const fidelityA = scoreFidelity(a) ?? EXACT_SCORE_FIDELITY;
    const fidelityB = scoreFidelity(b) ?? EXACT_SCORE_FIDELITY;
    if (fidelityA !== fidelityB) {
      throw new EvolutionControlError(
        `refusing to order a score measured at fidelity ${fidelityA} against ` +
          `one measured at fidelity ${fidelityB}: they are different ` +
          `measurements, not two values of the same one`,
        "MIXED_FIDELITY_COMPARISON",
      );
    }
    const scoreA = a.score;
    const scoreB = b.score;
    if (scoreA === undefined || scoreB === undefined) {
      throw new EvolutionControlError(
        "refusing to order a creature that has no score",
        "MIXED_FIDELITY_COMPARISON",
      );
    }
    return scoreB - scoreA;
  }

  /**
   * Take a false-optimum canary reading on an exact sweep.
   *
   * Jin (2011) §4's warning is about the **trend**: a divergence that widens at
   * every anchor is the search optimising the model's error rather than the
   * objective, and nothing in the fitness trace shows it happening. Two things
   * abandon the cheap path for the rest of the run — a single reading past
   * `canaryThreshold`, and `canaryWindow` consecutive readings each larger than
   * the last.
   *
   * @param generation - The generation the anchor was taken on.
   * @param approximate - The cheap scores the ordering was made from.
   * @param exact - The exact scores for the same creatures, in the same order.
   * @returns The reading. An undecidable one (fewer than two creatures) is
   *   returned with `divergence: null` and does not enter the trend history.
   */
  recordExactSweep(
    generation: number,
    approximate: readonly number[],
    exact: readonly number[],
  ): CanaryReading {
    const divergence = orderingDivergence(approximate, exact);
    const pairs = approximate.length < 2
      ? 0
      : (approximate.length * (approximate.length - 1)) / 2;

    if (divergence === null) {
      const reading: CanaryReading = {
        generation,
        divergence: null,
        pairs,
        widening: false,
        escalated: this.escalated,
      };
      this.lastReading = reading;
      return reading;
    }

    this.divergenceHistory.push(divergence);
    const widening = this.isWidening();
    if (
      !this.escalated && (divergence > this.config.canaryThreshold || widening)
    ) {
      this.escalatedAt = generation;
    }
    const reading: CanaryReading = {
      generation,
      divergence,
      pairs,
      widening,
      escalated: this.escalated,
    };
    this.lastReading = reading;
    return reading;
  }

  /** True when the last `canaryWindow` readings each exceeded the one before. */
  private isWidening(): boolean {
    const window = this.config.canaryWindow;
    if (this.divergenceHistory.length < window) return false;
    const recent = this.divergenceHistory.slice(-window);
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] <= recent[i - 1]) return false;
    }
    return true;
  }

  /**
   * Count what this generation actually cost, for the trace.
   *
   * @param population - The population as it stands after evaluation.
   * @returns The summary; `divergence` is the most recent canary reading.
   */
  summarise(population: readonly Creature[]): GenerationSummary {
    let exactEvaluations = 0;
    let approximateEvaluations = 0;
    for (const creature of population) {
      if (isExactScore(creature)) exactEvaluations++;
      else approximateEvaluations++;
    }
    return {
      generation: this.currentPlan.generation,
      strategy: this.currentPlan.strategy,
      fidelity: this.currentPlan.fidelity,
      reason: this.currentPlan.reason,
      exactEvaluations,
      approximateEvaluations,
      divergence: this.lastReading?.divergence ?? null,
      escalated: this.escalated,
    };
  }

  /**
   * Render a summary as the one line a generation writes to the run trace.
   *
   * @param summary - The summary to render.
   * @returns A single log line naming the fidelity and the exact count.
   */
  describe(summary: GenerationSummary): string {
    const divergence = summary.divergence === null
      ? "n/a"
      : summary.divergence.toFixed(3);
    return `[NEAT-AI] EvolutionControl: generation ${summary.generation} ` +
      `${summary.fidelity} (${summary.strategy}/${summary.reason}), ` +
      `${summary.exactEvaluations} exact / ` +
      `${summary.approximateEvaluations} approximate, ` +
      `canary divergence ${divergence}` +
      (summary.escalated ? " — ESCALATED: cheap path abandoned" : "");
  }

  /**
   * The warning a generation owes when the sweep did not do what the plan said.
   *
   * The strategies are a decision layer: they name a fidelity, and something
   * downstream has to honour it. Until a cheap evaluator passes its gate
   * (Issue #3927 found no safe sampling rate; Issue #3930's surrogate gate was
   * undecidable) nothing does, so an active strategy runs exact regardless.
   * That is a mismatch between what was asked for and what happened, and it
   * says so **loudly and once** rather than leaving a run to read a trace
   * claiming a fidelity it never used.
   *
   * @param summary - This generation's summary.
   * @returns The warning to log, or `undefined` when the plan was honoured or
   *   the mismatch has already been reported for this run.
   */
  unhonouredPlanWarning(summary: GenerationSummary): string | undefined {
    if (summary.fidelity !== "approximate") return undefined;
    if (summary.approximateEvaluations > 0) return undefined;
    if (this.reportedUnhonouredPlan) return undefined;
    this.reportedUnhonouredPlan = true;
    return `[NEAT-AI] EvolutionControl: strategy "${summary.strategy}" asked ` +
      `for an approximate sweep in generation ${summary.generation} and every ` +
      `creature was evaluated exactly — no cheap evaluator is wired into the ` +
      `evolution loop, so the strategy costs what "none" costs. See ` +
      `docs/EVOLUTION_CONTROL.md.`;
  }

  /** Clear all history. Call when starting a new run. */
  reset(): void {
    this.divergenceHistory = [];
    this.lastReading = undefined;
    this.escalatedAt = undefined;
    this.reportedUnhonouredPlan = false;
    this.currentPlan = offPlan(0, this.config.strategy);
  }
}

/** The plan for a generation the policy does not control. */
function offPlan(
  generation: number,
  strategy: EvolutionControlStrategy,
): GenerationPlan {
  return {
    generation,
    strategy,
    fidelity: "exact",
    exactSweep: true,
    reason: strategy === "none" ? "strategy-off" : "first-generation",
  };
}

/** Population copy sorted best-first; unscored creatures rank last. */
function rankByScore<T extends { score?: number }>(
  population: readonly T[],
): T[] {
  return [...population].sort((a, b) => {
    const scoreA = a.score ?? -Infinity;
    const scoreB = b.score ?? -Infinity;
    if (scoreA === scoreB) return 0;
    return scoreB - scoreA;
  });
}
