/**
 * Typed error for activation function failures.
 *
 * Consumers can catch `ActivationError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module ActivationError
 */

export type ActivationErrorReason =
  | "NON_FINITE_INPUT"
  | "NON_FINITE_RESULT"
  | "UNKNOWN_ACTIVATION";

export class ActivationError extends Error {
  override readonly name = "ActivationError";
  readonly reason: ActivationErrorReason;
  readonly activation: string;
  readonly input: number | number[];

  constructor(
    message: string,
    reason: ActivationErrorReason,
    activation: string,
    input: number | number[],
  ) {
    super(message);
    this.reason = reason;
    this.activation = activation;
    this.input = input;
  }
}
