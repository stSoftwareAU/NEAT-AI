/**
 * Typed error for configuration parsing and validation failures.
 *
 * Consumers can catch `ConfigurationError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module ConfigurationError
 */

export type ConfigurationErrorReason =
  | "INVALID_TYPE"
  | "OUT_OF_RANGE"
  | "NOT_INTEGER"
  | "NOT_FINITE"
  | "CROSS_FIELD_VALIDATION";

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  readonly reason: ConfigurationErrorReason;

  constructor(message: string, reason: ConfigurationErrorReason) {
    super(message);
    this.reason = reason;
  }
}
