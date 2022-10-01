import { CostInterface } from "../Costs.ts";
const MAX_VALUE = 1000;
/** Twelve steps Error */
export class TwelveSteps implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];

      const t1 = Math.min(1.1, Math.max(-1.1, t)) * 10;

      const o = output[i];
      const o1 = Math.min(1.1, Math.max(-1.1, o)) * 10;

      if (t1 >= 10 && o1 < -10 || t1 <= -10 && o1 > 10) {
        error += MAX_VALUE;
      } else if (t1 >= 5 && o1 <= -5 || t1 <= -5 && o1 >= 5) {
        error += Math.pow(t1 - o1, 2) * 2;
      } else {
        error += Math.pow(t1 - o1, 2);
      }
    }

    return error / len / MAX_VALUE;
  }
}
