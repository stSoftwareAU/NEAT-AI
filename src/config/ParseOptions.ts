/**
 * Parse and validate NeatOptions values when building NeatConfig.
 *
 * Issue #1280: Parse and validate all NeatOptions when building NeatConfig.
 * Callers (e.g. CLI, GRQ) can pass string or number; parsing and validation
 * happen once in createNeatConfig. NeatConfig is always valid after creation.
 */

export interface NumberConstraints {
  /** Minimum value (inclusive). */
  min?: number;
  /** Minimum value (exclusive). Use when value must be strictly greater than X. */
  minExclusive?: number;
  /** Maximum value (inclusive). */
  max?: number;
  /** Require integer value. */
  integer?: boolean;
}

/**
 * Parses a numeric option from NeatOptions.
 * Supports string (e.g. from CLI) and number. If absent, returns default.
 *
 * @param fieldName - Human-readable field name for error messages
 * @param value - Raw value (string, number, or undefined). Accepts unknown for CLI input.
 * @param defaultValue - Value to use when undefined/absent
 * @param constraints - Optional min, max, integer constraints
 * @returns Parsed, validated number
 * @throws Error with clear message when value fails to parse or is out of range
 */
export function parseNumber(
  fieldName: string,
  value: unknown,
  defaultValue: number,
  constraints?: NumberConstraints,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  let num: number;
  if (typeof value === "string") {
    num = Number(value);
    if (!Number.isFinite(num) || value.trim() === "") {
      throw new Error(
        `${fieldName} must be a number, got: ${JSON.stringify(value)}`,
      );
    }
  } else if (typeof value === "number") {
    num = value;
    if (!Number.isFinite(num)) {
      throw new Error(
        `${fieldName} must be a finite number, got: ${value}`,
      );
    }
  } else {
    throw new Error(
      `${fieldName} must be a number or string, got: ${typeof value}`,
    );
  }

  if (constraints?.integer) {
    if (!Number.isInteger(num)) {
      throw new Error(
        `${fieldName} must be an integer, got: ${num}`,
      );
    }
  }

  if (constraints?.min !== undefined && num < constraints.min) {
    const rangeMsg = constraints.max !== undefined
      ? `between ${constraints.min} and ${constraints.max}`
      : `at least ${constraints.min}`;
    throw new Error(
      `${fieldName} must be ${rangeMsg}, got: ${num}`,
    );
  }

  if (
    constraints?.minExclusive !== undefined && num <= constraints.minExclusive
  ) {
    throw new Error(
      `${fieldName} must be greater than ${constraints.minExclusive}, got: ${num}`,
    );
  }

  if (constraints?.max !== undefined && num > constraints.max) {
    const rangeMsg = constraints.min !== undefined
      ? `between ${constraints.min} and ${constraints.max}`
      : `at most ${constraints.max}`;
    throw new Error(
      `${fieldName} must be ${rangeMsg}, got: ${num}`,
    );
  }

  return num;
}

/** Sentinel for "discovery sampling disabled". Only -1 is allowed; other negatives (e.g. -0.12) are rejected. */
export const DISCOVERY_SAMPLE_RATE_DISABLED = -1;

/**
 * Parses discovery sample rate: -1 (disabled) or a number in [0, 1].
 * Rejects other negative values (e.g. -0.12) with a clear error so typos are caught.
 */
export function parseDiscoverySampleRate(
  value: unknown,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  let num: number;
  if (typeof value === "string") {
    num = Number(value);
    if (!Number.isFinite(num) || value.trim() === "") {
      throw new Error(
        `Discovery sample rate must be -1 (disabled) or between 0 and 1, got: ${
          JSON.stringify(value)
        }`,
      );
    }
  } else if (typeof value === "number") {
    num = value;
    if (!Number.isFinite(num)) {
      throw new Error(
        `Discovery sample rate must be -1 (disabled) or between 0 and 1, got: ${num}`,
      );
    }
  } else {
    throw new Error(
      `Discovery sample rate must be a number or string, got: ${typeof value}`,
    );
  }

  if (num === DISCOVERY_SAMPLE_RATE_DISABLED) {
    return num;
  }
  if (num >= 0 && num <= 1) {
    return num;
  }
  throw new Error(
    `Discovery sample rate must be -1 (disabled) or between 0 and 1, got: ${num}`,
  );
}
