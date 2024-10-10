import { ActivationRange } from "../../../propagate/ActivationRange.ts";
import type { ActivationInterface } from "../ActivationInterface.ts";
import type { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Scaled Exponential Linear Unit (SELU) activation function.
 *
 * This implementation uses constants ALPHA and SCALE, which are pre-defined values derived
 * from the paper "Self-Normalizing Neural Creatures" by Günter Klambauer, Thomas Unterthiner,
 * Andreas Mayr, and Sepp Hochreiter.
 *
 * - ALPHA = 1.6732632423543772848170429916717
 * - SCALE = 1.0507009873554804934193349852946
 *
 * These values are chosen to ensure self-normalizing properties for the activations, meaning
 * the outputs aim to have zero mean and unit variance across layers during the training process.
 *
 * For more details, see the paper: https://arxiv.org/pdf/1706.02515.pdf
 */
export class SELU implements ActivationInterface, UnSquashInterface {
  public static NAME = "SELU";

  private static ALPHA = 1.6732632423543772848170429916717;
  private static SCALE = 1.0507009873554804934193349852946;
  public readonly range: ActivationRange = new ActivationRange(
    this,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );

  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    const scaledActivation = activation / SELU.SCALE;

    if (scaledActivation > 0) {
      return scaledActivation;
    } else if (scaledActivation > -SELU.ALPHA) {
      return Math.log((scaledActivation / SELU.ALPHA) + 1);
    } else {
      // Handle case when scaledActivation <= -ALPHA
      // This is an approximation and may not be accurate
      return -1;
    }
  }

  getName() {
    return SELU.NAME;
  }

  squash(x: number) {
    // Clamp input to prevent overflow in exponential function
    const clampedX = Math.max(
      Math.min(x, Number.MAX_SAFE_INTEGER),
      Number.MIN_SAFE_INTEGER,
    );

    // Apply SELU activation function
    const fx = clampedX > 0
      ? clampedX
      : SELU.ALPHA * Math.exp(clampedX) - SELU.ALPHA;

    // Prevent overflow in the output by clamping the final value
    const scaledFx = fx * SELU.SCALE;
    const clampedFx = Math.max(
      Math.min(scaledFx, Number.MAX_SAFE_INTEGER),
      Number.MIN_SAFE_INTEGER,
    );

    // Use the ActivationRange to limit the output to the defined range
    return this.range.limit(clampedFx, clampedX);
  }
}
