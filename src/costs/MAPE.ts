import type { CostInterface } from "../Costs.ts";

/** Mean Absolute Percentage Error */
export class MAPE implements CostInterface {
  static readonly NAME = "MAPE";

  getName(): string {
    return MAPE.NAME;
  }

  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];
      const o = output[i];
      error += Math.abs((o - t) / Math.max(t, 1e-15));
    }

    return error / len;
  }
}
