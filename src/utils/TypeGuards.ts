/**
 * TypeGuards.ts - Shared runtime type guard utilities for serialisation
 * boundaries.
 *
 * Issue #2217: Centralised guards that replace unsafe `as unknown as
 * Record<string, unknown>` double-casts with validated narrowing.
 */

/**
 * Returns true when the value is a non-null, non-array plain object that
 * can safely be treated as `Record<string, unknown>`.
 */
export function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && value !== undefined &&
    typeof value === "object" && !Array.isArray(value);
}

/**
 * Narrows a value to `Record<string, unknown>` when it is a plain object,
 * or returns `undefined` otherwise.  Useful at serialisation boundaries
 * where JSON-parsed data may not match the expected shape.
 */
export function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
