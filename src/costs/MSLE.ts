import type { CostInterface } from "../Costs.ts";

/** Mean Squared Logarithmic Error */
export class MSLE implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    for (let i = output.length; i--;) {
      error += Math.log(Math.max(target[i], 1e-15)) -
        Math.log(Math.max(output[i], 1e-15));
    }

    return error;
  }
}
