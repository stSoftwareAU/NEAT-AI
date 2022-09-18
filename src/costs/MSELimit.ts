import { CostInterface } from "../Costs.ts";

/** Mean Squared Error */
export class MSELimit implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];

      const t1 = Math.min(1, Math.max(-1, t));

      const o = output[i];
      const o1 = Math.min(1, Math.max(-1, o));
      error += Math.pow(t1 - o1, 2);
    }

    return error / len;
  }
}
