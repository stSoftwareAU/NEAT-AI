import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";

export interface UnSquashInterface extends AbstractActivationInterface {
  unSquash(activation: number, hint?: number): number;
}

export function validationActivation(
  that: AbstractActivationInterface,
  activation: number,
) {
  const range = that.range();
  // Check if the activation is within the range
  if (
    !Number.isFinite(activation) || activation < range.low ||
    activation > range.high
  ) {
    const msg =
      `${that.getName()}: Activation ${activation} is outside the valid range [${range.low}, ${range.high}]`;
    throw new Error(msg);
  }
}
