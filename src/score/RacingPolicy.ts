/**
 * Racing policy for native batch scoring — Issue #3928.
 *
 * The scorer sweeps the corpus once and, under `--race-stdio`, publishes a
 * running per-creature partial score after every chunk. This module is the
 * decision rule on the other end of that protocol: it consumes
 * {@link PartialScore}s and answers with a {@link RacingVerdict} naming the
 * creatures that can no longer catch the leader.
 *
 * The rule is a Hoeffding race (Maron & Moore, 1994): abandon creature `c`
 * only when its running mean error exceeds the leader's by more than the
 * combined confidence bound on both means at their current sample counts.
 * Three guards sit in front of it, and each exists because the cheap version
 * of racing is wrong in a way that is invisible from the scores:
 *
 * 1. **A corpus-fraction floor.** Records arrive in corpus order, which is not
 *    a random sample, so an early prefix is not evidence about the whole
 *    corpus however tight the bound looks.
 * 2. **The leader is never abandoned**, and at least `minSurvivors` creatures
 *    always finish the corpus. `minSurvivors` comes from the run's `elitism`,
 *    so every elite slot can be filled from a creature holding an exact score —
 *    without it, a generation where too few candidates finished would promote
 *    an abandoned creature into an elite slot, and `Fitness` never re-scores a
 *    creature that already has one.
 * 3. **Exempt keys are never abandoned.** Elites carry an exact score and must
 *    keep it; a partial number must never enter an elitism comparison.
 *
 * Without a known corpus size the floor cannot be enforced, so the policy
 * refuses to abandon anyone at all rather than guessing — the first generation
 * of a run therefore always full-scores, and pays for the corpus size it then
 * uses for the rest of the run.
 *
 * @module RacingPolicy
 */

import type { RequiredRacingConfig } from "@config/RacingConfig.ts";

/** One creature's running score, as published by the scorer after a chunk. */
export interface PartialScore {
  /** Creature index within the scored directory; what a verdict names. */
  readonly index: number;
  /** Creature id — the `.json` file stem, i.e. the creature UUID. */
  readonly key: string;
  /** Mean error over the records scored so far. */
  readonly partialError: number;
  /** Records this creature has been scored against so far. */
  readonly recordsScored: number;
}

/** Verdict returned to the scorer after each chunk. */
export type RacingVerdict =
  | { readonly verdict: "continue" }
  | { readonly verdict: "abort"; readonly creatures: number[] }
  | { readonly verdict: "abortAll" };

/** A creature the policy abandoned, and where in the corpus it happened. */
export interface AbandonedCreature {
  readonly key: string;
  readonly index: number;
  /** Running mean error at the moment of abandonment. */
  readonly partialError: number;
  /** Records scored at the moment of abandonment. */
  readonly recordsScored: number;
  /** `recordsScored / corpusRecords` — where in the corpus it was dropped. */
  readonly corpusFraction: number;
}

/** Per-generation racing diagnostics. */
export interface RacingSummary {
  /** Creatures abandoned mid-corpus. */
  readonly abandoned: number;
  /** Creatures racing considered (the size of the raced batch). */
  readonly raced: number;
  /** Mean corpus fraction at abandonment; `0` when nothing was abandoned. */
  readonly meanAbandonFraction: number;
  /**
   * Fraction of the generation's record-scoring work the abandonments removed:
   * records skipped / records a full sweep would have scored.
   */
  readonly recordsSavedFraction: number;
}

/**
 * Hoeffding confidence radius for the mean of `records` samples of a loss
 * bounded in `[0, range]`, at confidence `1 - confidence`.
 *
 * `ε = range · sqrt(ln(2/δ) / (2n))`. Returns `Infinity` for a zero sample
 * count, which makes "not enough evidence" behave as "do not abandon".
 */
export function hoeffdingBound(
  range: number,
  records: number,
  confidence: number,
): number {
  if (records <= 0) return Infinity;
  return range * Math.sqrt(Math.log(2 / confidence) / (2 * records));
}

/**
 * The decision rule wired to the scorer's early-exit callback.
 *
 * One instance per generation: it accumulates the abandonments it ordered so
 * the caller can rank and report them afterwards.
 */
export class RacingPolicy {
  readonly #config: RequiredRacingConfig;
  readonly #exemptKeys: ReadonlySet<string>;
  readonly #corpusRecords: number;
  readonly #minSurvivors: number;
  readonly #abandoned: AbandonedCreature[] = [];
  #racedCount = 0;

  /**
   * @param config Resolved racing configuration.
   * @param options.exemptKeys Creature keys that must never be abandoned
   *   (elites and any creature whose exact score is relied on downstream).
   * @param options.corpusRecords Records in the full corpus. Omitted or
   *   non-positive means "unknown", and the policy never abandons anyone.
   * @param options.minSurvivors How many creatures must finish the corpus.
   *   Set from the run's `elitism` so every elite slot can be filled from a
   *   creature holding an exact score — an abandoned creature must never be
   *   promoted into an elite slot merely because too few candidates finished.
   *   Defaults to 2, the minimum elitism `NeatEvolution` ever uses.
   */
  constructor(
    config: RequiredRacingConfig,
    options?: {
      exemptKeys?: Iterable<string>;
      corpusRecords?: number;
      minSurvivors?: number;
    },
  ) {
    this.#config = config;
    this.#exemptKeys = new Set(options?.exemptKeys ?? []);
    const corpus = options?.corpusRecords ?? 0;
    this.#corpusRecords = Number.isFinite(corpus) && corpus > 0 ? corpus : 0;
    const survivors = options?.minSurvivors ?? 2;
    this.#minSurvivors = Number.isFinite(survivors) && survivors > 1
      ? Math.floor(survivors)
      : 2;
  }

  /** Creatures abandoned so far, in the order they were abandoned. */
  get abandoned(): readonly AbandonedCreature[] {
    return this.#abandoned;
  }

  /** Keys of the creatures abandoned so far. */
  abandonedKeys(): Set<string> {
    return new Set(this.#abandoned.map((a) => a.key));
  }

  /** Corpus size the floor is measured against; `0` when unknown. */
  get corpusRecords(): number {
    return this.#corpusRecords;
  }

  /**
   * Decide what to do after one scored chunk.
   *
   * The scorer publishes one {@link PartialScore} per **still-active**
   * creature, so an abandoned creature never reappears here.
   */
  onChunk(partials: readonly PartialScore[]): RacingVerdict {
    this.#racedCount = Math.max(
      this.#racedCount,
      partials.length + this.#abandoned.length,
    );
    const keepGoing: RacingVerdict = { verdict: "continue" };
    if (!this.#config.enabled) return keepGoing;
    // Unknown corpus size: the floor is unenforceable, so nothing is dropped.
    if (this.#corpusRecords <= 0) return keepGoing;
    // Never race the last creature standing — someone must finish the corpus.
    if (partials.length <= 1) return keepGoing;

    const leader = this.#leader(partials);
    if (leader === undefined) return keepGoing;
    const leaderBound = hoeffdingBound(
      this.#config.errorRange,
      leader.recordsScored,
      this.#config.confidence,
    );

    // Never let a race leave fewer creatures finishing the corpus than the
    // elite slots that must be filled from exact scores. Candidates are
    // considered worst-first so the cap, when it bites, keeps the best.
    let survivors = partials.length;
    const doomed: number[] = [];
    const worstFirst = [...partials].sort((a, b) => {
      const aError = Number.isFinite(a.partialError)
        ? a.partialError
        : Infinity;
      const bError = Number.isFinite(b.partialError)
        ? b.partialError
        : Infinity;
      if (aError !== bError) return bError - aError;
      return a.index - b.index;
    });
    for (const partial of worstFirst) {
      if (survivors <= this.#minSurvivors) break;
      if (partial.index === leader.index) continue;
      if (this.#exemptKeys.has(partial.key)) continue;
      if (!Number.isFinite(partial.recordsScored)) continue;
      const fraction = partial.recordsScored / this.#corpusRecords;
      if (!(fraction >= this.#config.minCorpusFraction)) continue;

      if (!Number.isFinite(partial.partialError)) {
        // A non-finite running error can never recover into a usable score;
        // past the floor there is nothing left to learn from it.
        this.#record(partial, fraction);
        doomed.push(partial.index);
        survivors--;
        continue;
      }
      const bound = leaderBound +
        hoeffdingBound(
          this.#config.errorRange,
          partial.recordsScored,
          this.#config.confidence,
        );
      if (partial.partialError - leader.partialError > bound) {
        this.#record(partial, fraction);
        doomed.push(partial.index);
        survivors--;
      }
    }

    if (doomed.length === 0) return keepGoing;
    doomed.sort((a, b) => a - b);
    return { verdict: "abort", creatures: doomed };
  }

  /**
   * Per-generation diagnostics.
   *
   * @param racedCount Creatures the generation raced. Defaults to the largest
   *   population the policy observed across its chunks.
   */
  summarise(racedCount?: number): RacingSummary {
    const raced = racedCount ?? this.#racedCount;
    if (this.#abandoned.length === 0 || raced === 0) {
      return {
        abandoned: 0,
        raced,
        meanAbandonFraction: 0,
        recordsSavedFraction: 0,
      };
    }
    const totalFraction = this.#abandoned.reduce(
      (sum, a) => sum + a.corpusFraction,
      0,
    );
    const savedRecords = this.#abandoned.reduce(
      (sum, a) => sum + Math.max(0, this.#corpusRecords - a.recordsScored),
      0,
    );
    return {
      abandoned: this.#abandoned.length,
      raced,
      meanAbandonFraction: totalFraction / this.#abandoned.length,
      recordsSavedFraction: this.#corpusRecords > 0
        ? savedRecords / (this.#corpusRecords * raced)
        : 0,
    };
  }

  /** Lowest finite running error in this chunk — the creature to beat. */
  #leader(partials: readonly PartialScore[]): PartialScore | undefined {
    let best: PartialScore | undefined;
    for (const partial of partials) {
      if (!Number.isFinite(partial.partialError)) continue;
      if (best === undefined || partial.partialError < best.partialError) {
        best = partial;
      }
    }
    return best;
  }

  #record(partial: PartialScore, fraction: number): void {
    this.#abandoned.push({
      key: partial.key,
      index: partial.index,
      partialError: partial.partialError,
      recordsScored: partial.recordsScored,
      corpusFraction: fraction,
    });
  }
}
