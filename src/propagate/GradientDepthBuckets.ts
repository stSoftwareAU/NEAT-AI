/**
 * @module
 *
 * The per-depth statistics {@link probeGradientDepth} collects: the
 * zero-gradient cause taxonomy, the shape of one depth bucket, and the
 * accumulator behind it.
 *
 * Split out of `GradientDepthProbe.ts` so the measurement (what the gradient
 * is) and the bookkeeping (what is done with it) stay separately readable.
 * Issue #3972.
 */

/** Why a neuron saw an exactly-zero gradient on one sample. */
export type ZeroGradientCause =
  /**
   * Every route out ran into a squash whose `derivative()` returned zero at
   * the value it was handed. That covers two different faults, which
   * {@link GradientDepthBucket.zeroDerivativeSquashes} separates by name: a
   * saturating squash outside its live region (`HARD_TANH` beyond `(-1, 1)`),
   * and a piecewise-constant one that returns zero for every input (`STEP`,
   * `BIPOLAR`), which passes no gradient anywhere at any depth.
   */
  | "zero-derivative"
  /**
   * The route lost a `MINIMUM` / `MAXIMUM` and sat outside the runner-up
   * proximity window, so the engine leaks it nothing either.
   */
  | "unselected-min-max"
  /** Every route out fed the branch an `IF` did not take. */
  | "untaken-if-branch"
  /** Every route out fed an `IF` condition — a threshold with no derivative. */
  | "if-condition"
  /** Every route out had weight zero. */
  | "zero-weight"
  /** Routes were open, but the neurons they lead to already had no gradient. */
  | "downstream-zero"
  /** Routes were open and carried gradient, but the contributions cancelled. */
  | "cancellation"
  /** The neuron has no forward route to anything at all. */
  | "unreached";

const ZERO_CAUSES: readonly ZeroGradientCause[] = [
  "zero-derivative",
  "unselected-min-max",
  "untaken-if-branch",
  "if-condition",
  "zero-weight",
  "downstream-zero",
  "cancellation",
  "unreached",
];

/** The measured gradient profile of one depth level. */
export interface GradientDepthBucket {
  /** Depth, as {@link computeLayerAssignments} assigns it. */
  depth: number;
  /** Distinct neurons at this depth that were measured. */
  neurons: number;
  /** Neuron × sample measurements taken at this depth. */
  observations: number;
  /** Measurements whose gradient was exactly zero. */
  zeroObservations: number;
  /** `zeroObservations / observations`, or `0` when nothing was measured. */
  zeroFraction: number;
  /** Mean `|gradient|` over every measurement, zeroes included. */
  meanAbsGradient: number;
  /**
   * Median `|gradient|`, nearest-rank; `quantilesTruncated` says when it was
   * read from a truncated sample of the measurements.
   */
  medianAbsGradient: number;
  /** 95th percentile `|gradient|`, nearest-rank. */
  p95AbsGradient: number;
  /** Largest `|gradient|` seen. */
  maxAbsGradient: number;
  /** Consecutive-sample pairs where both gradients were non-zero. */
  signFlipComparisons: number;
  /** Of those pairs, how many reversed sign — the shattered-gradient signal. */
  signFlips: number;
  /** `signFlips / signFlipComparisons`, or `0` when nothing was comparable. */
  signFlipRate: number;
  /** Zero-gradient measurements attributed to each construct. */
  zeroCauses: Record<ZeroGradientCause, number>;
  /**
   * Squash names blamed for `zero-derivative`, by blocked route. Read this
   * before concluding anything about saturation: a `STEP` here is a squash
   * with no slope anywhere, not one that saturated.
   */
  zeroDerivativeSquashes: Record<string, number>;
  /** True when the quantiles come from a truncated sample of measurements. */
  quantilesTruncated: boolean;
}

/** Default cap on retained `|gradient|` values per bucket. */
export const DEFAULT_QUANTILE_SAMPLE_LIMIT = 100_000;

/** Mutable accumulator behind one {@link GradientDepthBucket}. */
export class BucketAccumulator {
  readonly neurons = new Set<number>();
  observations = 0;
  zeroObservations = 0;
  absSum = 0;
  absMax = 0;
  signFlipComparisons = 0;
  signFlips = 0;
  readonly magnitudes: number[] = [];
  quantilesTruncated = false;
  readonly zeroCauses = new Map<ZeroGradientCause, number>();
  readonly zeroDerivativeSquashes = new Map<string, number>();

  constructor(readonly depth: number, private readonly limit: number) {}

  record(neuronIndex: number, gradient: number) {
    this.neurons.add(neuronIndex);
    this.observations++;
    const magnitude = Math.abs(gradient);
    this.absSum += magnitude;
    if (magnitude > this.absMax) this.absMax = magnitude;
    if (gradient === 0) this.zeroObservations++;
    if (this.magnitudes.length < this.limit) {
      this.magnitudes.push(magnitude);
    } else {
      this.quantilesTruncated = true;
    }
  }

  blame(cause: ZeroGradientCause, squash?: string) {
    this.zeroCauses.set(cause, (this.zeroCauses.get(cause) ?? 0) + 1);
    if (squash !== undefined) {
      this.zeroDerivativeSquashes.set(
        squash,
        (this.zeroDerivativeSquashes.get(squash) ?? 0) + 1,
      );
    }
  }

  compareSign(previous: number, current: number) {
    if (previous === 0 || current === 0) return;
    this.signFlipComparisons++;
    if (Math.sign(previous) !== Math.sign(current)) this.signFlips++;
  }

  finish(): GradientDepthBucket {
    const sorted = this.magnitudes.slice().sort((a, b) => a - b);
    const zeroCauses = {} as Record<ZeroGradientCause, number>;
    for (const cause of ZERO_CAUSES) {
      zeroCauses[cause] = this.zeroCauses.get(cause) ?? 0;
    }
    return {
      depth: this.depth,
      neurons: this.neurons.size,
      observations: this.observations,
      zeroObservations: this.zeroObservations,
      zeroFraction: this.observations === 0
        ? 0
        : this.zeroObservations / this.observations,
      meanAbsGradient: this.observations === 0
        ? 0
        : this.absSum / this.observations,
      medianAbsGradient: quantile(sorted, 0.5),
      p95AbsGradient: quantile(sorted, 0.95),
      maxAbsGradient: this.absMax,
      signFlipComparisons: this.signFlipComparisons,
      signFlips: this.signFlips,
      signFlipRate: this.signFlipComparisons === 0
        ? 0
        : this.signFlips / this.signFlipComparisons,
      zeroCauses,
      zeroDerivativeSquashes: Object.fromEntries(
        [...this.zeroDerivativeSquashes].sort((a, b) => b[1] - a[1]),
      ),
      quantilesTruncated: this.quantilesTruncated,
    };
  }
}

/** Nearest-rank percentile: the smallest value at or above `fraction`. */
function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}
