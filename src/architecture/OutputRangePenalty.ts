/**
 * OutputRangePenalty.ts - Computes fitness penalty for out-of-range outputs.
 *
 * Issue #1620: When outputRanges are configured, creatures whose evaluation
 * outputs fall outside the specified [min, max] range receive an additive
 * penalty proportional to the excess.
 */

import type { RequiredOutputRange } from "../config/OutputRangeConfig.ts";

/**
 * Calculates the output range penalty for a single activation record.
 *
 * For each output that falls outside its configured range, the penalty is:
 *   penaltyWeight * (excess / rangeSpan)^2
 *
 * The quadratic form penalises large violations more heavily while being
 * lenient for near-boundary outputs. Normalising by the range span ensures
 * narrow and wide ranges produce comparable penalty magnitudes.
 *
 * @param outputs - The creature's actual output values for one record
 * @param ranges - The configured output range constraints
 * @returns The total penalty for this record (0 when all outputs are in range)
 */
export function calculateOutputRangePenalty(
  outputs: Float32Array | number[],
  ranges: ReadonlyArray<RequiredOutputRange>,
): number {
  let penalty = 0;
  const len = Math.min(outputs.length, ranges.length);

  for (let i = 0; i < len; i++) {
    const value = outputs[i];
    const range = ranges[i];
    const { min, max, penaltyWeight } = range;

    if (value < min) {
      const rangeSpan = max - min;
      const excess = min - value;
      const normalised = rangeSpan > 0 ? excess / rangeSpan : excess;
      penalty += penaltyWeight * normalised * normalised;
    } else if (value > max) {
      const rangeSpan = max - min;
      const excess = value - max;
      const normalised = rangeSpan > 0 ? excess / rangeSpan : excess;
      penalty += penaltyWeight * normalised * normalised;
    }
  }

  return penalty;
}
