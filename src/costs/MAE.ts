import type { CostInterface } from "../Costs.ts";

/** Mean Absolute Error */
export class MAE implements CostInterface {
  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      error += Math.abs(target[i] - output[i]);
    }

    return error / len;
  }
}
