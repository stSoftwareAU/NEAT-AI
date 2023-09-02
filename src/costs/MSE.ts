import { CostInterface } from "../Costs.ts";

/** Mean Squared Error */
export class MSE implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    const len = output.length;
    const invLen = 1 / len;

    for (let i = len; i--;) {
      const diff = target[i] - output[i];
      error += diff * diff;
    }

    return error * invLen;
  }
}
