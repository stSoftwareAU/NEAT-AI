import { ActivationInterface } from "../ActivationInterface.ts";

/**
 * https://arxiv.org/pdf/1706.02515.pdf
 */
export class SELU implements ActivationInterface {
  public static NAME = "SELU";

  private static ALPHA = 1.6732632423543772848170429916717;
  private static SCALE = 1.0507009873554804934193349852946;

  getName() {
    return SELU.NAME;
  }

  squash(x: number) {
    const fx= x > 0 ? x : SELU.ALPHA * Math.exp(x) - SELU.ALPHA;

    return fx * SELU.SCALE;
  }

  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: x > 0 ? SELU.SCALE : (fx/SELU.SCALE + SELU.ALPHA) * SELU.SCALE,
    };
  }
}
