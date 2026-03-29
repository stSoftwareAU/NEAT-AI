/**
 * Typed error for validation failures.
 *
 * Consumers can catch `ValidationError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module ValidationError
 */

export type ValidationErrorName =
  | "OTHER"
  | "NO_OUTWARD_CONNECTIONS"
  | "NO_INWARD_CONNECTIONS"
  | "IF_CONDITIONS"
  | "RECURSIVE_SYNAPSE"
  | "SELF_CONNECTION"
  | "DUPLICATE_SYNAPSE"
  | "MEMETIC";

export class ValidationError extends Error {
  override readonly name = "ValidationError";
  readonly reason: ValidationErrorName;

  constructor(message: string, reason: ValidationErrorName) {
    super(message);
    this.reason = reason;
  }
}
