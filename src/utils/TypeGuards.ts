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
