import { CostInterface } from "../Costs.ts";

/** Mean Squared Error */
export class MSE implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      error += Math.pow(target[i] - output[i], 2);
    }

    return error / len;
  }
}
