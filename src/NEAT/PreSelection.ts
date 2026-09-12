/**
 * Offspring pre-selection — the surplus-and-screen lever of Jin (2011) §4.
 *
 * Issue #3932. NEAT-AI bred exactly the offspring the population budget called
 * for and sent every one of them into `Fitness.calculate()` at full corpus
 * cost. There was no point in the pipeline where a candidate could be created
 * and then rejected before it was expensive — the only pre-fitness filter,
 * {@link ../architecture/DeDuplicator.ts}, declines to score the same creature
 * twice and is perfectly happy to spend a full evaluation on twenty distinct
 * bad ones.
 *
 * This is that point. Breed a **surplus**, rank it with a cheap
 * {@link ./OffspringScreen.ts}, keep the population-sized survivor set, and
 * discard the rest before anyone pays for them.
 *
 * ```mermaid
 * flowchart TD
 *   Q[population budget: N slots] --> T{ratio > 1<br/>and screen ready?}
 *   T -->|no| B1[breed N] --> F[Fitness.calculate: N exact]
 *   T -->|yes| B2["breed ceil(N x ratio)"] --> S[screen the surplus]
 *   S --> R[random survivors:<br/>uniform over ALL candidates]
 *   S --> K[rank survivors:<br/>best predicted first]
 *   R --> V[N survivors]
 *   K --> V
 *   V --> F
 *   S --> D[discarded: never scored,<br/>never archived, never exported]
 * ```
 *
 * ## What this is not
 *
 * It is not evolution control (Issue #3931). That decides which of the
 * creatures that exist earn an exact score this generation; this decides how
 * many creatures exist at all. They compose, and either ships without the
 * other.
 *
 * ## The invariants
 *
 * - **A screened-out creature is discarded, never recorded.** Its screen value
 *   is not a fitness: it never reaches `Creature.score`, the evaluation
 *   archive, species statistics or an export. `select` verifies that the
 *   screen did not write a score.
 * - **A fixed fraction of survivors is drawn uniformly, not by rank.**
 *   Screening exclusively on predicted quality is a diversity sink: it
 *   discards the structurally unusual candidates the screen is least able to
 *   judge, which are exactly the ones NEAT depends on for novel topology.
 * - **Elites are never screened.** They are not offspring; the stage only ever
 *   sees the bred slice.
 * - **An unready screen breeds no surplus**, so nothing is discarded on the
 *   strength of a number the screen could not produce.
 * - **The screen rank of every eventual elite is reported**, so a screen
 *   anti-correlated with what matters is visible in the trace.
 *
 * See [`docs/PRE_SELECTION.md`](../../docs/PRE_SELECTION.md).
 *
 * @module PreSelection
 */

import type { Creature } from "@creature";
import type {
  PreSelectionScreenName,
  RequiredPreSelectionConfig,
} from "@config/PreSelectionConfig.ts";
import type { OffspringScreen } from "@neat/OffspringScreen.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import { isExactScore } from "@architecture/ScoreFidelity.ts";
import { SurrogateGuard } from "@surrogate/SurrogateGuard.ts";
import type {
  Allocation,
  AllocationDiagnostics,
} from "@surrogate/ExactEvaluationAllocator.ts";
import { acquisitionValue } from "@surrogate/Acquisition.ts";
import type { DriftReading } from "@surrogate/DriftMonitor.ts";
import { isPrediction } from "@surrogate/UncertainSurrogate.ts";
import {
  getRandomNumberGenerator,
  type RandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/** Where one survivor came from. */
export type SurvivorReason =
  /** Kept because the screen ranked it inside the top slots. */
  | "rank"
  /** Kept by the uniform draw, whatever the screen thought of it. */
  | "random"
  /**
   * Kept because the surrogate **refused to predict** it — its descriptor
   * falls outside the region the archive covers, so only a true evaluation can
   * say what it is worth (Issue #3933).
   */
  | "out-of-distribution"
  /**
   * Kept by the uncertainty floor: the model is least sure about it, whatever
   * it predicted for it (Issue #3933).
   */
  | "uncertainty";

/** The screen's verdict on one creature, kept so an elite can be traced back. */
export interface ScreenRank {
  /** Zero-based position in the screen's ordering, best first. */
  readonly rank: number;
  /** Candidates the rank was taken over. */
  readonly of: number;
  /**
   * The raw screen value. Never a fitness.
   *
   * `null` when the surrogate **refused to predict** this candidate (Issue
   * #3933): a refusal has no number behind it, and substituting one — a window
   * mean, a zero — would be the fabricated prediction the refusal exists to
   * prevent.
   */
  readonly value: number | null;
  /** Why it survived. */
  readonly reason: SurvivorReason;
  /** The generation it was screened in. */
  readonly generation: number;
}

/** What one generation's pre-selection produced. */
export interface PreSelectionOutcome {
  /** The creatures that go on to a true evaluation, best-ranked first. */
  readonly survivors: Creature[];
  /** The creatures dropped. They carry no score and are never recorded. */
  readonly discarded: Creature[];
  /** The per-generation diagnostics. */
  readonly summary: PreSelectionSummary;
}

/** What one generation's pre-selection cost and did, for the trace. */
export interface PreSelectionSummary {
  readonly generation: number;
  readonly screen: PreSelectionScreenName;
  readonly ratio: number;
  /** Offspring the breeder actually produced. */
  readonly offspringGenerated: number;
  /** Offspring that survived the screen. */
  readonly survivors: number;
  /** Offspring discarded before anyone paid for them. */
  readonly screenedOut: number;
  /** Survivors kept by the uniform draw rather than by rank. */
  readonly randomSurvivors: number;
  /** Wall-clock the screen itself cost, in milliseconds. */
  readonly screenMs: number;
  /** False when the screen could not rank and no surplus was bred. */
  readonly screenReady: boolean;
  /**
   * What the acquisition rule spent this generation, or `undefined` when the
   * uncertainty guard was not consulted (Issue #3933).
   */
  readonly surrogate?: AllocationDiagnostics;
}

/**
 * The per-generation over-generate-and-screen policy.
 *
 * @example
 * ```ts
 * const preSelection = new PreSelection(config, screen);
 * const target = preSelection.offspringTarget(populationSlots);
 * const offspring = await breeder.breedBatch(target);
 * const outcome = await preSelection.select(offspring, populationSlots, gen);
 * // only outcome.survivors reaches Fitness.calculate()
 * ```
 */
export class PreSelection {
  private readonly config: RequiredPreSelectionConfig;
  private readonly offspringScreen: OffspringScreen | undefined;
  /**
   * Ranks from the generation just screened.
   *
   * Keyed on the **creature itself**, not on its UUID (Issue #4008): mutation
   * invalidates a creature's UUID and the evolution loop only recomputes it
   * during fitness, so a freshly bred offspring is screened while it has none.
   * A map keyed on the UUID therefore recorded nothing at all in a real run,
   * and the elite screen rank — the number that decides whether the screen is
   * worth having — reported an empty list on every generation, silently.
   */
  private ranks = new WeakMap<Creature, ScreenRank>();
  /** Creatures already recorded as elites, so a survivor is counted once. */
  private recordedElites = new WeakSet<Creature>();
  /** Ranks from the generation before that — where this one's elites came from. */
  private previousRanks = new WeakMap<Creature, ScreenRank>();
  private lastSummary: PreSelectionSummary | undefined;
  private readonly eliteRanks: ScreenRank[] = [];
  /** The uncertainty guard, when the screen can answer to one (Issue #3933). */
  private readonly guard: SurrogateGuard | undefined;
  /**
   * Predicted value per screened creature, awaiting its exact score.
   *
   * Keyed on the **creature itself**, not on its UUID: mutation invalidates a
   * creature's UUID and the evolution loop only recomputes it during fitness,
   * so a freshly bred offspring is screened while it has none. Keying on the
   * UUID would therefore record nothing in a real run and the drift monitor
   * would silently never see a residual. A weak map also needs no generational
   * rotation — an entry dies with the creature it belongs to.
   */
  private predictions = new WeakMap<Creature, number>();
  /** Best exact score the run has seen — the incumbent EI measures against. */
  private bestExactScore = -Infinity;
  private lastDrift: DriftReading | undefined;

  /**
   * @param config - Fully resolved configuration; the
   *   `DEFAULT_PRE_SELECTION_CONFIG` of `PreSelectionConfig.ts` leaves the
   *   stage off.
   * @param screen - The screen the configuration named, or `undefined`.
   */
  constructor(
    config: RequiredPreSelectionConfig,
    screen?: OffspringScreen,
  ) {
    this.config = config;
    this.offspringScreen = screen;
    // Issue #3933: a fitness approximation that cannot report an uncertainty
    // is not eligible. The `"sampled"` screen is not one — it is a real, cheap
    // evaluation — so only the surrogate is held to this.
    if (
      config.screen === "surrogate" && config.uncertainty.enabled &&
      screen !== undefined && screen.verdicts === undefined
    ) {
      throw new PreSelectionError(
        `the "surrogate" screen supplied cannot report an uncertainty for ` +
          `its predictions, so no acquisition rule can be applied to it: ` +
          `every exact evaluation would land where the model is already ` +
          `confident and the model would never be corrected where it is ` +
          `wrong. Implement verdicts(), or set ` +
          `preSelection.uncertainty.enabled to false and accept the Issue ` +
          `#3932 argmax knowingly.`,
        "SURROGATE_WITHOUT_UNCERTAINTY",
      );
    }
    // The guard exists only where it can do its job: a screen that cannot
    // report an uncertainty cannot be held to an acquisition rule, and
    // pretending otherwise would report a floor nothing enforced.
    this.guard = config.uncertainty.enabled && screen?.verdicts !== undefined
      ? new SurrogateGuard(config.uncertainty)
      : undefined;
  }

  /**
   * True when a surplus is bred and screened.
   *
   * False for the rest of the run once the drift monitor has disabled the
   * surrogate path (Issue #3933): a model whose mistakes stopped being
   * symmetric is not screened *less*, it is not consulted at all, and every
   * candidate goes to a true evaluation.
   */
  get active(): boolean {
    if (this.guard?.disabled === true) return false;
    return this.config.ratio > 1 && this.offspringScreen !== undefined;
  }

  /** The uncertainty guard, or `undefined` when the screen cannot answer one. */
  get surrogateGuard(): SurrogateGuard | undefined {
    return this.guard;
  }

  /** The most recent drift reading, or `undefined`. */
  get lastDriftReading(): DriftReading | undefined {
    return this.lastDrift;
  }

  /** The configured screen name. */
  get screenName(): PreSelectionScreenName {
    return this.config.screen;
  }

  /** The screen itself, for a caller that has exact scores to feed it. */
  get screen(): OffspringScreen | undefined {
    return this.offspringScreen;
  }

  /** The most recent generation's diagnostics, or `undefined`. */
  get lastGeneration(): PreSelectionSummary | undefined {
    return this.lastSummary;
  }

  /**
   * The screen ranks of the creatures that went on to become elites — the
   * number that decides whether the screen is worth having.
   */
  get eliteScreenRanks(): readonly ScreenRank[] {
    return this.eliteRanks;
  }

  /**
   * How many offspring the breeder should be asked for.
   *
   * @param slots - Offspring the population budget calls for.
   * @returns `slots` when the stage is off or the screen is not ready yet, and
   *   `ceil(slots × ratio)` when it is on. A non-positive budget is returned
   *   unchanged — there is nothing to over-generate.
   */
  offspringTarget(slots: number): number {
    if (slots <= 0 || !this.active) return slots;
    if (!this.offspringScreen?.ready()) return slots;
    return Math.ceil(slots * this.config.ratio);
  }

  /**
   * Feed a generation's exact scores to a screen that learns from them.
   *
   * Two kinds of creature are skipped, and for different reasons:
   *
   * - **No score, or a non-finite one.** A creature that took `-Infinity` for a
   *   WASM panic never earned a fitness reading, and teaching a surrogate that
   *   number teaches it about the runtime.
   * - **An approximate score** (Issue #3931's `scoreFidelity` tag). Evolution
   *   control and pre-selection compose, so a run may be holding cheap scores
   *   when this is called; a model fitted to a mixture of fidelities is fitted
   *   to two different measurements at once.
   *
   * @param population - The population as it stands after evaluation.
   * @param generation - The generation just evaluated, for the drift reading
   *   (Issue #3933). Defaults to the generation last screened.
   */
  observe(population: readonly Creature[], generation?: number): void {
    const screen = this.offspringScreen;
    for (const creature of population) {
      const score = creature.score;
      if (score === undefined || !Number.isFinite(score)) continue;
      if (!isExactScore(creature)) continue;
      // The incumbent expected improvement is measured against. It is an
      // exact score by construction — EI against the model's own optimism is
      // a rule with no ground truth in it.
      if (score > this.bestExactScore) this.bestExactScore = score;
      const predicted = this.predictions.get(creature);
      if (predicted !== undefined) {
        this.guard?.observe(predicted, score);
        // Consumed: a creature that survives many generations is differenced
        // once, against the first exact score it earned.
        this.predictions.delete(creature);
      }
      screen?.observe?.(creature, score);
    }
    // Issue #3933: the residuals of this generation become one drift reading.
    // Called once per generation, beside the exact scores that produced them.
    if (this.guard !== undefined) {
      this.lastDrift = this.guard.closeGeneration(
        generation ?? this.lastSummary?.generation ?? 0,
      );
    }
  }

  /**
   * Screen a surplus down to the population budget.
   *
   * @param candidates - Every offspring the breeder produced this generation.
   * @param slots - Offspring the population budget calls for.
   * @param generation - The generation being bred for, for the trace.
   * @param rng - Random source for the uniform draw; the global one by default.
   * @returns The survivors, the discards and the diagnostics. With the stage
   *   off, or no surplus to cut, every candidate survives in the order given.
   * @throws {PreSelectionError} `SCREEN_WROTE_SCORE` when the screen assigned a
   *   score to a candidate — a screen value is not a fitness.
   */
  async select(
    candidates: readonly Creature[],
    slots: number,
    generation: number,
    rng: RandomNumberGenerator = getRandomNumberGenerator(),
  ): Promise<PreSelectionOutcome> {
    const screen = this.offspringScreen;
    const inactive = !this.active || screen === undefined ||
      !screen.ready() || candidates.length <= slots || slots <= 0;
    if (inactive) {
      return this.passThrough(candidates, generation, screen?.ready() ?? false);
    }

    const scoresBefore = candidates.map((candidate) => candidate.score);
    const screenStartMs = Date.now();
    // Issue #3933: a screen that can report an uncertainty is consulted for
    // verdicts, and the exact-evaluation slots are allocated by an acquisition
    // rule rather than by predicted rank. One that cannot keeps the Issue
    // #3932 argmax, which is all it can honestly support.
    const guard = this.guard?.active === true ? this.guard : undefined;
    const askForVerdicts = guard === undefined
      ? undefined
      : screen.verdicts?.bind(screen);
    const verdicts = askForVerdicts?.(candidates);
    const values: readonly (number | null)[] = verdicts === undefined
      ? await screen.screen(candidates)
      : verdicts.map((verdict) => isPrediction(verdict) ? verdict.value : null);
    const screenMs = Date.now() - screenStartMs;
    this.assertNoScoreWritten(candidates, scoresBefore);

    // The incumbent expected improvement measures against: the best exact
    // score this stage has seen, or the best in the model's own window when
    // the screen was taught directly. Both are ground truth; a predicted best
    // is not.
    const incumbent = Math.max(
      this.bestExactScore,
      screen.bestObservedScore?.() ?? -Infinity,
    );
    // Best first. A stable tie-break on the candidate's own position keeps a
    // same-seed run reproducible when the screen cannot separate two
    // candidates. With the guard on, "best" is the acquisition value and a
    // refusal sorts to the front — an out-of-distribution candidate is not a
    // bad candidate, it is an unmeasured one, and it is the one a true
    // evaluation buys the most information about.
    const keys = verdicts === undefined
      ? (values as readonly number[])
      : verdicts.map((verdict) =>
        isPrediction(verdict)
          ? acquisitionValue(
            this.config.uncertainty.acquisition,
            verdict,
            incumbent,
            this.config.uncertainty.kappa,
          )
          : Infinity
      );
    const order = candidates.map((_, index) => index);
    order.sort((a, b) => (keys[a] === keys[b] ? a - b : keys[b] - keys[a]));
    const rankOf = new Array<number>(candidates.length);
    for (let rank = 0; rank < order.length; rank++) {
      rankOf[order[rank]] = rank;
    }

    // The uniform draw comes first and runs over *every* candidate, so a
    // survivor it picks is genuinely independent of the screen's ordering.
    const randomTarget = Math.min(
      slots,
      Math.round(slots * this.config.randomSurvivorFraction),
    );
    const chosen = new Set<number>();
    const reasons = new Map<number, SurvivorReason>();
    const pool = candidates.map((_, index) => index);
    for (let drawn = 0; drawn < randomTarget && pool.length > 0; drawn++) {
      const pick = Math.floor(rng.random() * pool.length);
      const index = pool.splice(pick, 1)[0];
      chosen.add(index);
      reasons.set(index, "random");
    }
    // Issue #3933: the remaining slots are the exact evaluations the
    // acquisition rule allocates — refusals first, then the uncertainty floor,
    // then expected improvement or the confidence bound. Without the guard
    // this is the Issue #3932 fill from the top of the predicted ranking.
    let allocation: Allocation | undefined;
    if (guard !== undefined && verdicts !== undefined) {
      const available = candidates
        .map((_, index) => index)
        .filter((index) => !chosen.has(index));
      allocation = guard.allocate(
        available.map((index) => verdicts[index]),
        Math.max(0, Math.min(slots - chosen.size, available.length)),
        incumbent,
      );
      // The uniform draw already spent slots on creatures the guard did not
      // choose; they are exact evaluations too, and the run's exploration
      // share is measured against all of them.
      guard.recordExternalExactEvaluations(chosen.size);
      for (const slot of allocation.slots) {
        const index = available[slot.index];
        chosen.add(index);
        // `"rank"` is the ranking rule's own band, whichever rule it is: the
        // acquisition ordering here, the predicted-score argmax without the
        // guard.
        reasons.set(
          index,
          slot.reason === "acquisition" ? "rank" : slot.reason,
        );
      }
    } else {
      for (const index of order) {
        if (chosen.size >= slots) break;
        if (chosen.has(index)) continue;
        chosen.add(index);
        reasons.set(index, "rank");
      }
    }

    // Survivors are handed on best-ranked first so the population array stays
    // pseudo-sorted, as every other producer leaves it.
    const survivors: Creature[] = [];
    const discarded: Creature[] = [];
    this.previousRanks = this.ranks;
    this.ranks = new WeakMap();
    for (const index of order) {
      const creature = candidates[index];
      if (!chosen.has(index)) {
        discarded.push(creature);
        continue;
      }
      survivors.push(creature);
      // Issue #3933: remember what the model said, so the exact score that
      // arrives for this creature next generation can be differenced against
      // it. That difference is the drift monitor's whole input, and it is
      // recorded against the creature rather than its UUID because a bred
      // offspring has not been given one yet.
      const predicted = values[index];
      if (predicted !== null) this.predictions.set(creature, predicted);
      // Issue #4008: recorded against the creature, as the prediction map
      // above already is. A bred offspring has no UUID at this point —
      // mutation invalidated it and fitness has not recomputed it yet — so a
      // rank keyed on the UUID would be recorded for nobody a real run breeds.
      this.ranks.set(creature, {
        rank: rankOf[index],
        of: candidates.length,
        value: values[index],
        reason: reasons.get(index) ?? "rank",
        generation,
      });
    }

    let randomSurvivors = 0;
    for (const reason of reasons.values()) {
      if (reason === "random") randomSurvivors++;
    }
    const summary: PreSelectionSummary = {
      generation,
      screen: this.config.screen,
      ratio: this.config.ratio,
      offspringGenerated: candidates.length,
      survivors: survivors.length,
      screenedOut: discarded.length,
      randomSurvivors,
      screenMs,
      screenReady: true,
      ...(allocation === undefined
        ? {}
        : { surrogate: allocation.diagnostics }),
    };
    this.lastSummary = summary;
    return { survivors, discarded, summary };
  }

  /**
   * The screen's verdict on a creature, when it was screened recently.
   *
   * Two generations of ranks are kept — the one just screened and the one
   * before it, which is where this generation's elites were bred — so the
   * lookup is bounded on a long run. A creature that has been an elite for
   * longer than that reports `null` rather than a rank from a screen that no
   * longer exists.
   *
   * @param creature - The creature to look up.
   * @returns Its rank, or `null` when it was not screened recently.
   */
  screenRankOf(creature: Creature): ScreenRank | null {
    return this.ranks.get(creature) ?? this.previousRanks.get(creature) ?? null;
  }

  /**
   * Record the screen ranks of this generation's elites.
   *
   * This is the diagnostic the issue names as the one that decides whether the
   * screen works: if elites routinely come from the bottom of the screen's
   * ordering, the screen is anti-correlated with what matters.
   *
   * **One observation per creature.** An elite survives many generations, and
   * counting its rank again on each of them would weight the distribution
   * towards long-lived elites rather than towards the screen's judgement — the
   * aggregate would then say more about elitism than about the screen. The
   * returned array is this generation's elites, whether or not they were new;
   * only {@link eliteScreenRanks} is deduplicated.
   *
   * @param elitists - The elite band, which is never itself screened.
   * @returns The ranks that were known, in the order the elites were given.
   */
  recordElites(elitists: readonly Creature[]): ScreenRank[] {
    const found: ScreenRank[] = [];
    for (const elite of elitists) {
      const rank = this.screenRankOf(elite);
      if (rank === null) continue;
      found.push(rank);
      // Issue #4008: the dedup is on the creature too. Keyed on a UUID a bred
      // offspring does not carry, every elite looked new and none was ever
      // recorded.
      if (this.recordedElites.has(elite)) continue;
      this.recordedElites.add(elite);
      this.eliteRanks.push(rank);
    }
    return found;
  }

  /**
   * Render a summary as the one line a generation writes to the run trace.
   *
   * @param summary - The summary to render.
   * @returns A single line naming what was generated, kept and discarded.
   */
  describe(summary: PreSelectionSummary): string {
    if (!summary.screenReady) {
      return `[NEAT-AI] PreSelection: generation ${summary.generation} bred ` +
        `${summary.offspringGenerated} offspring with no surplus — the ` +
        `${JSON.stringify(summary.screen)} screen is not ready to rank yet`;
    }
    return `[NEAT-AI] PreSelection: generation ${summary.generation} bred ` +
      `${summary.offspringGenerated} offspring at ratio ${summary.ratio}, ` +
      `kept ${summary.survivors} (${summary.randomSurvivors} at random), ` +
      `screened out ${summary.screenedOut} in ${summary.screenMs}ms ` +
      `(${summary.screen})`;
  }

  /**
   * The line reporting where this generation's elites sat in the screen's
   * ordering, or `undefined` when none of them was screened by this stage.
   *
   * @param ranks - The ranks {@link recordElites} returned.
   */
  describeEliteRanks(ranks: readonly ScreenRank[]): string | undefined {
    if (ranks.length === 0) return undefined;
    const parts = ranks.map((rank) =>
      `${rank.rank + 1}/${rank.of}${
        rank.reason === "random" ? " (random)" : ""
      }`
    );
    return `[NEAT-AI] PreSelection: elite screen rank(s) ${parts.join(", ")} ` +
      `— a screen whose elites come from the bottom of its own ordering is ` +
      `anti-correlated with what matters`;
  }

  /**
   * The three guard numbers this run has accumulated — signed bias, the
   * fraction of exact evaluations spent on uncertainty, and the
   * out-of-distribution rate (Issue #3933).
   *
   * @returns The line, or `undefined` when no guard is attached.
   */
  describeSurrogateRun(): string | undefined {
    return this.guard?.describeRun();
  }

  /**
   * The per-generation acquisition line.
   *
   * @returns The line, or `undefined` when the guard was not consulted this
   *   generation.
   */
  describeAllocation(): string | undefined {
    return this.guard?.describeAllocation();
  }

  /**
   * The drift line for the generation just observed — loud on the generation
   * the surrogate path is disabled in.
   *
   * @returns The line, or `undefined` when there was nothing to report.
   */
  describeDrift(): string | undefined {
    const reading = this.lastDrift;
    if (reading === undefined || this.guard === undefined) return undefined;
    return this.guard.describeDrift(reading);
  }

  /** Clear all history. Call when starting a new run. */
  reset(): void {
    this.ranks = new WeakMap();
    this.previousRanks = new WeakMap();
    this.lastSummary = undefined;
    this.eliteRanks.length = 0;
    this.recordedElites = new WeakSet();
    this.predictions = new WeakMap();
    this.bestExactScore = -Infinity;
    this.lastDrift = undefined;
    this.guard?.reset();
  }

  /** Everything survives: the stage is off, unready, or has no surplus. */
  private passThrough(
    candidates: readonly Creature[],
    generation: number,
    screenReady: boolean,
  ): PreSelectionOutcome {
    const summary: PreSelectionSummary = {
      generation,
      screen: this.config.screen,
      ratio: this.config.ratio,
      offspringGenerated: candidates.length,
      survivors: candidates.length,
      screenedOut: 0,
      randomSurvivors: 0,
      screenMs: 0,
      screenReady,
    };
    if (this.active) this.lastSummary = summary;
    return { survivors: [...candidates], discarded: [], summary };
  }

  /** Refuse a screen that recorded its opinion as a fitness. */
  private assertNoScoreWritten(
    candidates: readonly Creature[],
    before: readonly (number | undefined)[],
  ): void {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].score === before[i]) continue;
      throw new PreSelectionError(
        `the ${JSON.stringify(this.config.screen)} screen wrote a score to ` +
          `candidate ${
            candidates[i].uuid?.substring(0, 8) ?? "<no uuid>"
          }: a screen value decides what is worth measuring and must never be ` +
          `recorded as a measurement`,
        "SCREEN_WROTE_SCORE",
      );
    }
  }
}
