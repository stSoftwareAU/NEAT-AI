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

  // range() {
  //   return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };
  // }

  getName() {
    return SELU.NAME;
  }

  squash(x: number) {
    const fx = x > 0 ? x : SELU.ALPHA * Math.exp(x) - SELU.ALPHA;

    return fx * SELU.SCALE;
  }
}
