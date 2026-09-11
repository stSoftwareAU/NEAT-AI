/**
 * The signed-bias drift monitor — Issue #3933.
 *
 * A surrogate's *absolute* error is the wrong thing to watch. Jin (2011) §5:
 * the model does not merely make mistakes, it makes **consistent** mistakes,
 * and the search finds them. Symmetric error is ordinary noise the selection
 * pressure averages out; persistent one-directional bias is the false-optimum
 * signature, and it can be far smaller than the absolute error and still be
 * fatal.
 *
 * The GRQ regime makes that concrete. Accepted improvements on the
 * forward-only lineage run around 1e-05, so a surrogate biased by 1e-04 in a
 * consistent direction is *within the noise of its own validation* and
 * invisible to any aggregate accuracy metric — while being ten times the size
 * of the signal the run is selecting on.
 *
 * So the reading is scale-free:
 *
 * ```text
 * bias ratio = mean(predicted - exact) / mean(|predicted - exact|)
 * ```
 *
 * which is `+1` when every residual points the same way, `-1` when they all
 * point the other, and near `0` for symmetric noise of any magnitude. A
 * generation whose |ratio| reaches the configured threshold counts towards a
 * streak; `driftGenerations` consecutive such generations **in the same
 * direction** disable the surrogate path for the remainder of the run.
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> Watching
 *   Watching --> Watching: symmetric residuals, streak resets
 *   Watching --> Streak: |bias ratio| >= threshold
 *   Streak --> Watching: sign flips or ratio falls back
 *   Streak --> Disabled: streak reaches driftGenerations
 *   Disabled --> [*]: surrogate path off for the rest of the run
 * ```
 *
 * @module DriftMonitor
 */

import type { RequiredSurrogateUncertaintyConfig } from "@config/SurrogateUncertaintyConfig.ts";

/** What one generation's residuals said. */
export interface DriftReading {
  readonly generation: number;
  /** Residuals the reading was taken over. */
  readonly samples: number;
  /** Mean signed residual `predicted - exact`, in score units. */
  readonly signedBias: number;
  /** Mean absolute residual, in score units. */
  readonly meanAbsoluteResidual: number;
  /**
   * `signedBias / meanAbsoluteResidual`, in `[-1, 1]`, or `null` when the
   * generation carried too few residuals to say anything. An undecidable
   * reading is never a pass — it simply does not count either way.
   */
  readonly biasRatio: number | null;
  /** Consecutive generations of one-directional bias, this one included. */
  readonly streak: number;
  /** True once the surrogate path has been disabled for the run. */
  readonly escalated: boolean;
}

/**
 * Tracks predictions against the exact scores that arrive later.
 *
 * One instance per run. Residuals are accumulated as they arrive and folded
 * into a reading at the end of each generation, so the monitor holds four
 * numbers rather than a growing list.
 */
export class SignedBiasDriftMonitor {
  private readonly config: RequiredSurrogateUncertaintyConfig;
  private signedSum = 0;
  private absoluteSum = 0;
  private samples = 0;
  private streak = 0;
  private streakSign = 0;
  private escalatedAt: number | null = null;
  private runSignedSum = 0;
  private runAbsoluteSum = 0;
  private runSamples = 0;
  private ratioSum = 0;
  private ratioGenerations = 0;
  private lastReading: DriftReading | undefined;

  constructor(config: RequiredSurrogateUncertaintyConfig) {
    this.config = config;
  }

  /** True once the surrogate path has been disabled for the rest of the run. */
  get escalated(): boolean {
    return this.escalatedAt !== null;
  }

  /** The generation the escalation fired in, or `null`. */
  get escalatedGeneration(): number | null {
    return this.escalatedAt;
  }

  /** Residuals recorded across the whole run. */
  get runResiduals(): number {
    return this.runSamples;
  }

  /** Mean signed residual across the whole run, in score units. */
  get runSignedBias(): number {
    return this.runSamples === 0 ? 0 : this.runSignedSum / this.runSamples;
  }

  /** Mean absolute residual across the whole run, in score units. */
  get runMeanAbsoluteResidual(): number {
    return this.runSamples === 0 ? 0 : this.runAbsoluteSum / this.runSamples;
  }

  /**
   * Bias ratio over the run's **pooled** residuals, or `null` with none.
   *
   * Pooling is not robust: one creature that scored four orders of magnitude
   * below the rest — an early topology that simply does not work — dominates
   * both sums and drags this reading towards `±1` however symmetric every
   * generation was. It is reported because it is the raw arithmetic, and
   * {@link generationBiasRatio} is the reading to judge a run on.
   */
  get runBiasRatio(): number | null {
    if (this.runSamples === 0 || this.runAbsoluteSum === 0) return null;
    return this.runSignedSum / this.runAbsoluteSum;
  }

  /**
   * Mean of the **per-generation** bias ratios, or `null` when no generation
   * carried enough residuals to decide one.
   *
   * This is the reading the escalation rule is built on, and the one to judge
   * a run by: each generation contributes once whatever its residuals cost, so
   * a single catastrophic creature moves one generation's ratio rather than
   * the whole run's.
   */
  get generationBiasRatio(): number | null {
    if (this.ratioGenerations === 0) return null;
    return this.ratioSum / this.ratioGenerations;
  }

  /** The most recent generation's reading, or `undefined`. */
  get lastGeneration(): DriftReading | undefined {
    return this.lastReading;
  }

  /**
   * Record one prediction against the exact score that arrived for it.
   *
   * A non-finite pair is ignored rather than folded in: a creature that took
   * `-Infinity` for a WASM panic never earned a fitness reading, and a
   * residual against it measures the runtime.
   *
   * @param predicted - What the surrogate said.
   * @param exact - What the full evaluation returned.
   */
  record(predicted: number, exact: number): void {
    if (!Number.isFinite(predicted) || !Number.isFinite(exact)) return;
    const residual = predicted - exact;
    this.signedSum += residual;
    this.absoluteSum += Math.abs(residual);
    this.samples++;
    this.runSignedSum += residual;
    this.runAbsoluteSum += Math.abs(residual);
    this.runSamples++;
  }

  /**
   * Fold this generation's residuals into a reading and update the streak.
   *
   * @param generation - The generation just finished.
   * @returns The reading. Call once per generation.
   */
  closeGeneration(generation: number): DriftReading {
    const samples = this.samples;
    const signedBias = samples === 0 ? 0 : this.signedSum / samples;
    const meanAbsoluteResidual = samples === 0 ? 0 : this.absoluteSum / samples;
    let biasRatio: number | null = null;
    if (samples >= this.config.driftMinSamples) {
      // A generation the model got exactly right reads as zero bias, not as
      // silence: every residual was zero, which is the strongest evidence
      // available that the bias is gone, so it resets the streak.
      biasRatio = this.absoluteSum === 0
        ? 0
        : this.signedSum / this.absoluteSum;
      this.ratioSum += biasRatio;
      this.ratioGenerations++;
    }
    if (biasRatio === null) {
      // Undecidable: the streak is left standing rather than reset. A
      // generation that produced too few residuals is silence, and silence is
      // not evidence that the bias went away.
    } else if (Math.abs(biasRatio) >= this.config.driftBiasRatio) {
      const sign = biasRatio > 0 ? 1 : -1;
      this.streak = sign === this.streakSign ? this.streak + 1 : 1;
      this.streakSign = sign;
      if (
        this.streak >= this.config.driftGenerations && this.escalatedAt === null
      ) {
        this.escalatedAt = generation;
      }
    } else {
      this.streak = 0;
      this.streakSign = 0;
    }
    this.signedSum = 0;
    this.absoluteSum = 0;
    this.samples = 0;
    const reading: DriftReading = {
      generation,
      samples,
      signedBias,
      meanAbsoluteResidual,
      biasRatio,
      streak: this.streak,
      escalated: this.escalatedAt !== null,
    };
    this.lastReading = reading;
    return reading;
  }

  /**
   * The line a generation writes to the run trace, or `undefined` when the
   * generation carried no residuals to report.
   *
   * @param reading - The reading to render.
   * @returns One line, loud when the escalation has fired.
   */
  describe(reading: DriftReading): string | undefined {
    if (reading.samples === 0) return undefined;
    const ratio = reading.biasRatio === null
      ? "undecidable"
      : reading.biasRatio.toFixed(3);
    if (reading.escalated && reading.generation === this.escalatedAt) {
      return `[NEAT-AI] Surrogate DISABLED at generation ` +
        `${reading.generation}: the surrogate over-predicted in one ` +
        `direction for ${reading.streak} consecutive generation(s) (bias ` +
        `ratio ${ratio}, mean signed bias ` +
        `${reading.signedBias.toExponential(3)}). A one-directional bias is ` +
        `the false-optimum signature of Jin (2011) §5, so the surrogate path ` +
        `is off for the rest of this run and every candidate is evaluated ` +
        `exactly.`;
    }
    return `[NEAT-AI] Surrogate drift: generation ${reading.generation} ` +
      `signed bias ${reading.signedBias.toExponential(3)} over ` +
      `${reading.samples} prediction(s), bias ratio ${ratio}, streak ` +
      `${reading.streak}/${this.config.driftGenerations}`;
  }

  /** Drop everything learnt. Call when starting a new run. */
  reset(): void {
    this.signedSum = 0;
    this.absoluteSum = 0;
    this.samples = 0;
    this.streak = 0;
    this.streakSign = 0;
    this.escalatedAt = null;
    this.runSignedSum = 0;
    this.runAbsoluteSum = 0;
    this.runSamples = 0;
    this.ratioSum = 0;
    this.ratioGenerations = 0;
    this.lastReading = undefined;
  }
}
