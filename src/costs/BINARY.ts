import type { CostInterface } from "../Costs.ts";

/** Binary error */
export class BINARY implements CostInterface {
  static readonly NAME = "BINARY";

  getName(): string {
    return BINARY.NAME;
  }

  calculate(target: Float32Array, output: Float32Array): number {
    let misses = 0;
    for (let i = output.length; i--;) {
      misses += Math.round(target[i] * 2) !== Math.round(output[i] * 2) ? 0 : 1;
    }

    return misses;
  }
}
