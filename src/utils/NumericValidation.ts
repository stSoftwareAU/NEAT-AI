/**
 * Shared numeric validation helpers.
 *
 * Issue #2222: Extracted from repeated assertion patterns in Score.ts and
 * other modules to reduce duplication and ensure consistent error messages.
 *
 * @module
 */

import { assert } from "@std/assert";

/**
 * Asserts that a value is a finite, non-negative number.
 *
 * Checks, in order: not NaN, finite, and >= 0. Throws with a clear,
 * consistent error message including the field name and offending value.
 *
 * @param value - The number to validate
 * @param name - A human-readable label included in error messages
 * @throws {Error} When the value is NaN, non-finite, or negative
 */
export function assertFiniteNonNegative(value: number, name: string): void {
  assert(!Number.isNaN(value), `${name} is NaN`);
  assert(Number.isFinite(value), `${name} is not finite: ${value}`);
  assert(value >= 0, `${name} is negative: ${value}`);
}

/**
 * Asserts that a value is a finite number (may be negative).
 *
 * Checks, in order: not NaN and finite. Useful for values like weights
 * and biases that can legitimately be negative but must still be finite.
 *
 * @param value - The number to validate
 * @param name - A human-readable label included in error messages
 * @throws {Error} When the value is NaN or non-finite
 */
export function assertFiniteNumber(value: number, name: string): void {
  assert(!Number.isNaN(value), `${name} is NaN`);
  assert(Number.isFinite(value), `${name} is not finite: ${value}`);
}
