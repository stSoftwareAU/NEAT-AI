import type { CostInterface } from "../Costs.ts";

/** Binary error */
export class BINARY implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let misses = 0;
    for (let i = output.length; i--;) {
      misses += Math.round(target[i] * 2) !== Math.round(output[i] * 2) ? 0 : 1;
    }

    return misses;
  }
}
