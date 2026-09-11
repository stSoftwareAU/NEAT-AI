/**
 * The region of descriptor space the archive actually covers — Issue #3933.
 *
 * "Refuse to extrapolate" is the third of the issue's three refusals. When a
 * candidate's descriptor falls outside the region the model's own evidence
 * covers — the window of exact `(descriptor, score)` pairs the run has paid
 * for, which is the same record the evaluation archive of Issue #3929 keeps —
 * the model must **report that** rather than return a number. In a NEAT population this is not an edge case: novel topologies are
 * the whole mechanism, and they are by construction the points the model has
 * no data near. A surrogate that silently extrapolates onto them is a
 * surrogate that systematically misjudges exactly the candidates that matter.
 *
 * Two tests, and a candidate need only fail one:
 *
 * - **The box.** Every kept descriptor slot must sit inside the range the
 *   training set spans, widened by a configured margin in standard deviations.
 *   A creature with three times the neurons of anything in the archive is out
 *   of distribution however ordinary its other slots look.
 * - **The radius.** The nearest training point must be closer than a radius
 *   taken from the training set's own nearest-neighbour distances — the
 *   `coverageQuantile` quantile of them, times `coverageFactor`. A candidate
 *   inside the box but in a hole the archive never visited is still an
 *   extrapolation.
 *
 * The radius is taken from the data rather than configured absolutely, so it
 * travels between a 40-neuron toy creature and a 5,300-neuron GRQ one without
 * anyone re-tuning it.
 *
 * @module CoverageRegion
 */

import {
  applyFeatureScaler,
  euclideanDistance,
  type FeatureScaler,
  fitFeatureScaler,
} from "@surrogate/FeatureScaler.ts";
import type { OutOfDistributionVerdict } from "@surrogate/UncertainSurrogate.ts";
import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** How a coverage region is drawn around a training set. */
export interface CoverageOptions {
  /** Quantile of the training nearest-neighbour distances, in `(0, 1]`. */
  readonly quantile: number;
  /** Multiplier on that distance, `>= 1`. */
  readonly factor: number;
  /** Standard deviations beyond the observed range still counted as inside. */
  readonly margin: number;
}

/** Where a candidate sits relative to the region. */
export interface CoverageReading {
  /** True when the candidate is inside on both tests. */
  readonly inside: boolean;
  /** Distance to the nearest training point, in standardised units. */
  readonly distance: number;
  /** The radius that distance was judged against. */
  readonly radius: number;
  /** The refusal to hand back when `inside` is false. */
  readonly verdict?: OutOfDistributionVerdict;
}

/**
 * The fitted region.
 *
 * Holds the standardised training rows, so it is the same size as the window
 * the surrogate was fitted to and no larger.
 */
export class CoverageRegion {
  private readonly scaler: FeatureScaler;
  private readonly rows: readonly (readonly number[])[];
  private readonly lower: readonly number[];
  private readonly upper: readonly number[];
  private readonly width: number;
  /** The radius a candidate's nearest-neighbour distance is judged against. */
  readonly radius: number;

  private constructor(
    scaler: FeatureScaler,
    rows: readonly (readonly number[])[],
    lower: readonly number[],
    upper: readonly number[],
    radius: number,
    width: number,
  ) {
    this.scaler = scaler;
    this.rows = rows;
    this.lower = lower;
    this.upper = upper;
    this.radius = radius;
    this.width = width;
  }

  /** Descriptor slots the region was fitted over. */
  get descriptorWidth(): number {
    return this.width;
  }

  /** Training points the region was drawn from. */
  get size(): number {
    return this.rows.length;
  }

  /**
   * The training rows in standardised space.
   *
   * Shared with the model fitted to the same window, so a candidate cannot be
   * judged *covered* under one scaling and predicted under another.
   */
  get scaledRows(): readonly (readonly number[])[] {
    return this.rows;
  }

  /**
   * Project a raw descriptor into the region's standardised space.
   *
   * @param features - One raw descriptor.
   * @returns The standardised row, one entry per informative column.
   */
  project(features: readonly number[]): number[] {
    return applyFeatureScaler(this.scaler, features);
  }

  /**
   * Fit a region to the descriptors the archive holds.
   *
   * @param descriptors - Raw descriptors, all of the same width.
   * @param options - How wide to draw the region.
   * @returns The fitted region.
   * @throws {SurrogateUncertaintyError} `INVALID_COVERAGE_REGION` when there
   *   are no descriptors, they disagree on width, or one is not finite. A
   *   region fitted to a `NaN` would call everything covered.
   */
  static fit(
    descriptors: readonly (readonly number[])[],
    options: CoverageOptions,
  ): CoverageRegion {
    if (descriptors.length === 0) {
      throw new SurrogateUncertaintyError(
        "a coverage region cannot be fitted to an empty archive: with no " +
          "data, every candidate is an extrapolation and none can be ruled in",
        "INVALID_COVERAGE_REGION",
      );
    }
    const width = descriptors[0].length;
    for (let i = 0; i < descriptors.length; i++) {
      const row = descriptors[i];
      if (row.length !== width) {
        throw new SurrogateUncertaintyError(
          `archived descriptor ${i} has ${row.length} slots, the region is ` +
            `being fitted over ${width}`,
          "INVALID_COVERAGE_REGION",
        );
      }
      for (let j = 0; j < width; j++) {
        if (!Number.isFinite(row[j])) {
          throw new SurrogateUncertaintyError(
            `archived descriptor ${i} slot ${j} is ${row[j]}: a coverage ` +
              `region fitted to a non-finite descriptor would rule every ` +
              `candidate covered`,
            "INVALID_COVERAGE_REGION",
          );
        }
      }
    }
    const scaler = fitFeatureScaler(descriptors);
    const rows = descriptors.map((row) => applyFeatureScaler(scaler, row));
    const kept = scaler.keep.length;
    const lower = new Array<number>(kept).fill(Infinity);
    const upper = new Array<number>(kept).fill(-Infinity);
    for (const row of rows) {
      for (let i = 0; i < kept; i++) {
        if (row[i] < lower[i]) lower[i] = row[i];
        if (row[i] > upper[i]) upper[i] = row[i];
      }
    }
    for (let i = 0; i < kept; i++) {
      lower[i] -= options.margin;
      upper[i] += options.margin;
    }
    return new CoverageRegion(
      scaler,
      rows,
      lower,
      upper,
      nearestNeighbourRadius(rows, options),
      width,
    );
  }

  /**
   * Decide whether a candidate is inside the region.
   *
   * @param features - The candidate's raw descriptor.
   * @returns The reading, carrying the refusal when it is outside.
   * @throws {SurrogateUncertaintyError} `INVALID_COVERAGE_REGION` when the
   *   descriptor is the wrong width — two descriptor versions in one run
   *   compare slots that are not the same quantity.
   */
  classify(features: readonly number[]): CoverageReading {
    if (features.length !== this.width) {
      throw new SurrogateUncertaintyError(
        `candidate descriptor has ${features.length} slots, the coverage ` +
          `region was fitted over ${this.width}`,
        "INVALID_COVERAGE_REGION",
      );
    }
    for (let i = 0; i < features.length; i++) {
      if (Number.isFinite(features[i])) continue;
      return outside(
        `descriptor slot ${i} is ${features[i]}`,
        Infinity,
        this.radius,
      );
    }
    const row = applyFeatureScaler(this.scaler, features);
    for (let i = 0; i < row.length; i++) {
      if (row[i] >= this.lower[i] && row[i] <= this.upper[i]) continue;
      const overshoot = row[i] < this.lower[i]
        ? this.lower[i] - row[i]
        : row[i] - this.upper[i];
      return outside(
        `descriptor slot ${this.scaler.keep[i]} sits ${
          overshoot.toFixed(3)
        } standard deviations outside the range the archive covers`,
        overshoot,
        0,
      );
    }
    // Every informative column was dropped: the archive cannot tell these
    // creatures apart, so there is no distance to be outside of. Saying
    // "covered" here is honest — the box test already passed vacuously — and
    // the prediction that follows carries the window's own spread as its
    // uncertainty, which is the correct amount of doubt.
    if (row.length === 0) {
      return { inside: true, distance: 0, radius: this.radius };
    }
    let nearest = Infinity;
    for (const trained of this.rows) {
      const distance = euclideanDistance(row, trained);
      if (distance < nearest) nearest = distance;
      if (nearest === 0) break;
    }
    if (nearest > this.radius) {
      return outside(
        `nearest archived creature is ${nearest.toFixed(3)} away in ` +
          `standardised descriptor space, past the ${
            this.radius.toFixed(3)
          } radius the archive covers`,
        nearest,
        this.radius,
      );
    }
    return { inside: true, distance: nearest, radius: this.radius };
  }
}

/** Build the outside reading and its refusal together, so they cannot drift. */
function outside(
  reason: string,
  distance: number,
  limit: number,
): CoverageReading {
  return {
    inside: false,
    distance,
    radius: limit,
    verdict: { kind: "out-of-distribution", reason, distance, limit },
  };
}

/**
 * The radius, taken from the training set's own nearest-neighbour distances.
 *
 * A training set whose points are all coincident yields a radius of `0`, and
 * every candidate that is not exactly on top of one is then out of
 * distribution. That is the honest reading rather than a degenerate one: an
 * archive that has visited a single point in descriptor space genuinely
 * supports no extrapolation at all, and routing those candidates to exact
 * evaluation is the safe direction to be wrong in.
 */
function nearestNeighbourRadius(
  rows: readonly (readonly number[])[],
  options: CoverageOptions,
): number {
  if (rows.length < 2 || rows[0].length === 0) return 0;
  const nearest: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    let best = Infinity;
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const distance = euclideanDistance(rows[i], rows[j]);
      if (distance < best) best = distance;
    }
    if (Number.isFinite(best)) nearest.push(best);
  }
  if (nearest.length === 0) return 0;
  nearest.sort((a, b) => a - b);
  const index = Math.min(
    nearest.length - 1,
    Math.max(0, Math.ceil(options.quantile * nearest.length) - 1),
  );
  return nearest[index] * options.factor;
}
