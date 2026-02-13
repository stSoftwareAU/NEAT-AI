/**
 * Typed error for discovery/FFI failures.
 *
 * Consumers can catch `DiscoveryError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module DiscoveryError
 */

export type DiscoveryErrorReason =
  | "LIBRARY_NOT_FOUND"
  | "GPU_UNAVAILABLE"
  | "FFI_CRASH"
  | "TIMEOUT"
  | "DATA_CORRUPTION"
  | "INVALID_CREATURE";

export class DiscoveryError extends Error {
  override readonly name = "DiscoveryError";
  readonly reason: DiscoveryErrorReason;

  constructor(message: string, reason: DiscoveryErrorReason) {
    super(message);
    this.reason = reason;
  }
}
