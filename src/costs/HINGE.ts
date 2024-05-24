import type { CostInterface } from "../Costs.ts";

/** Hinge loss, for classifiers */
export class HINGE implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    for (let i = output.length; i--;) {
      error += Math.max(0, 1 - target[i] * output[i]);
    }

    return error;
  }
}
