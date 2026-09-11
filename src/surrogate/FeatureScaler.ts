/**
 * Column-wise standardisation of structural descriptors — Issue #3933.
 *
 * Every consumer of the Issue #3929 descriptor needs the same thing before it
 * can measure a distance: columns on a common scale, and the columns that
 * carry no information dropped rather than turned into an infinity. The
 * surrogate screen, the coverage region and the distance-weighted prediction
 * all share this one implementation so a candidate cannot be *inside* the
 * coverage region of one scaling and *outside* another.
 *
 * @module FeatureScaler
 */

import { SurrogateUncertaintyError } from "@errors/SurrogateUncertaintyError.ts";

/** Column means and standard deviations of the informative columns. */
export interface FeatureScaler {
  /** Indices of the columns that survived, in ascending order. */
  readonly keep: readonly number[];
  /** Mean of each kept column. */
  readonly mean: readonly number[];
  /** Standard deviation of each kept column, always positive. */
  readonly sd: readonly number[];
}

/**
 * Relative standard deviation below which a descriptor column counts as
 * constant and is dropped.
 *
 * Comfortably above the ~1e-16 of double rounding and far below any real
 * structural difference, so it separates float noise from signal without
 * discarding a slot that genuinely varies a little.
 */
export const CONSTANT_COLUMN_EPS = 1e-12;

/**
 * Fit a scaler to a set of descriptor rows.
 *
 * A column every creature shares is dropped — but its variance is rarely
 * *exactly* zero: `sum / n` of n identical values need not reproduce the
 * value, so a constant column can carry ~1e-17 of float noise. Dividing by
 * that turns rounding error into a full standard deviation and lets a slot
 * with no information dominate the distance, so the test is relative to the
 * column's own magnitude rather than against zero.
 *
 * @param rows - The descriptor rows, all of the same width.
 * @returns The fitted scaler. `keep` is empty when every column is constant,
 *   which is the honest answer rather than an error: the descriptor cannot
 *   tell these rows apart.
 * @throws {SurrogateUncertaintyError} `EMPTY_TRAINING_SET` when no rows were
 *   given — there is nothing to centre or scale against.
 */
export function fitFeatureScaler(
  rows: readonly (readonly number[])[],
): FeatureScaler {
  if (rows.length === 0) {
    throw new SurrogateUncertaintyError(
      "cannot fit a feature scaler to an empty training set: there is " +
        "nothing to centre or scale against, so every distance taken " +
        "afterwards would be measured against nothing",
      "EMPTY_TRAINING_SET",
    );
  }
  const width = rows[0].length;
  const keep: number[] = [];
  const mean: number[] = [];
  const sd: number[] = [];
  for (let column = 0; column < width; column++) {
    let sum = 0;
    for (const row of rows) sum += row[column];
    const columnMean = sum / rows.length;
    let variance = 0;
    for (const row of rows) {
      const delta = row[column] - columnMean;
      variance += delta * delta;
    }
    const columnSd = Math.sqrt(variance / rows.length);
    if (columnSd <= Math.max(Math.abs(columnMean), 1) * CONSTANT_COLUMN_EPS) {
      continue;
    }
    keep.push(column);
    mean.push(columnMean);
    sd.push(columnSd);
  }
  return { keep, mean, sd };
}

/**
 * Project a raw descriptor into the scaler's kept, standardised space.
 *
 * @param scaler - The fitted scaler.
 * @param features - One raw descriptor.
 * @returns The standardised row, one entry per kept column.
 */
export function applyFeatureScaler(
  scaler: FeatureScaler,
  features: readonly number[],
): number[] {
  const scaled = new Array<number>(scaler.keep.length);
  for (let i = 0; i < scaler.keep.length; i++) {
    scaled[i] = (features[scaler.keep[i]] - scaler.mean[i]) / scaler.sd[i];
  }
  return scaled;
}

/**
 * Euclidean distance between two rows of the same length.
 *
 * @param a - First row.
 * @param b - Second row.
 * @returns The distance; `0` for zero-width rows, where nothing separates them.
 */
export function euclideanDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}
