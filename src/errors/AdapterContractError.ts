/**
 * Typed error for {@link EpisodeAdapter} contract violations (Issue #2626).
 *
 * Raised lazily on first use of a misbehaving adapter — e.g. a non-positive
 * `observationLength`, a non-positive guard value, or a non-`Float32Array`
 * observation returned by `reset()` / `step()`. Validation is deliberately
 * deferred from the constructor so subclasses can run their own
 * initialisation before the contract is checked.
 *
 * Consumers can catch `AdapterContractError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module AdapterContractError
 */

export type AdapterContractErrorReason =
  | "INVALID_OBSERVATION_LENGTH"
  | "INVALID_MAX_STEPS"
  | "INVALID_WALL_CLOCK_MS"
  | "INVALID_OBSERVATION_TYPE"
  | "INVALID_OBSERVATION_SIZE";

export class AdapterContractError extends Error {
  override readonly name = "AdapterContractError";
  readonly reason: AdapterContractErrorReason;

  constructor(message: string, reason: AdapterContractErrorReason) {
    super(message);
    this.reason = reason;
  }
}
