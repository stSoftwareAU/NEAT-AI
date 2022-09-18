import { CostInterface } from "../Costs.ts";

/** Mean Absolute Error */
export class MAE implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      error += Math.abs(target[i] - output[i]);
    }

    return error / len;
  }
}
