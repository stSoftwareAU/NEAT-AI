/**
 * Discovery Formatting Module
 *
 * Provides formatting utilities for discovery evaluation summaries,
 * including percentage formatting with significant digits and
 * colour-coded error delta display.
 *
 * Extracted from DiscoveryRunner.ts as part of #1598.
 */

import { green, red, yellow } from "@std/fmt/colors";

const MIN_PERCENT_FRACTION_DIGITS = 3;
const SIGNIFICANT_PERCENT_DIGITS = 3;
const MAX_PERCENT_FRACTION_DIGITS = 100;
const ZERO_PERCENT = `+0.${"0".repeat(MIN_PERCENT_FRACTION_DIGITS)}%`;

/**
 * Formats a percentage value with appropriate significant digits.
 * Used for displaying error deltas and expected improvements in discovery evaluation summaries.
 *
 * @param value - The percentage value to format (e.g., 0.5 for 0.5%)
 * @returns Formatted string like "+0.500%" or "-1.23%"
 */
export function formatPercentWithSignificantDigits(value: number): string {
  if (value === 0) {
    return ZERO_PERCENT;
  }
  const sign = value >= 0 ? "+" : "-";
  const absValue = Math.abs(value);
  const exponent = Math.floor(Math.log10(absValue));
  let fractionDigits: number;
  if (Number.isFinite(exponent) && exponent >= 0) {
    const digitsBeforeDecimal = exponent + 1;
    fractionDigits = Math.max(
      MIN_PERCENT_FRACTION_DIGITS,
      SIGNIFICANT_PERCENT_DIGITS - digitsBeforeDecimal,
    );
  } else {
    const leadingZeros = Number.isFinite(exponent)
      ? Math.abs(exponent) - 1
      : SIGNIFICANT_PERCENT_DIGITS;
    fractionDigits = Math.max(
      MIN_PERCENT_FRACTION_DIGITS,
      leadingZeros + SIGNIFICANT_PERCENT_DIGITS,
    );
  }
  fractionDigits = Math.min(fractionDigits, MAX_PERCENT_FRACTION_DIGITS);
  const magnitude = absValue.toFixed(fractionDigits);
  return `${sign}${magnitude}%`;
}

/**
 * Formats an error delta percentage with colour coding.
 * Green for improvements > 0.05%, red for declines < -0.05%, yellow otherwise.
 *
 * @param value - The error delta percentage (e.g., 0.5 for 0.5% improvement)
 * @returns Formatted and colour-coded string
 */
export function formatErrorDelta(value: number): string {
  if (!Number.isFinite(value)) {
    return yellow("±0.000%");
  }
  const formatted = formatPercentWithSignificantDigits(value);
  if (value > 0.05) return green(formatted);
  if (value < -0.05) return red(formatted);
  return yellow(formatted);
}
