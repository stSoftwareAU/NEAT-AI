/**
 * Shared utility for serialising unknown catch values into Error instances
 * or error message strings.
 *
 * Eliminates the duplicated `error instanceof Error ? ... : ...` pattern
 * across worker-related files.
 *
 * @module
 */

/** Extract error message from unknown catch value. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ensure unknown catch value is an Error instance. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
