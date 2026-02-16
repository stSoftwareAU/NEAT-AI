/**
 * Typed error for network topology errors.
 *
 * Consumers can catch `TopologyError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module TopologyError
 */

export type TopologyErrorReason =
  | "INVALID_NEURON_TYPE"
  | "INVALID_SQUASH"
  | "MISSING_SQUASH"
  | "INVALID_CONNECTION"
  | "INVALID_STATE"
  | "DUPLICATE_UUID"
  | "MISSING_NEURON"
  | "SORT_FAILURE"
  | "EXCESSIVE_ERRORS";

export class TopologyError extends Error {
  override readonly name = "TopologyError";
  readonly reason: TopologyErrorReason;

  constructor(message: string, reason: TopologyErrorReason) {
    super(message);
    this.reason = reason;
  }
}
