import { CostInterface } from "../Costs.ts";

/** Cross entropy error */
export class CrossEntropy implements CostInterface {
  calculate(target: number[], output: number[]): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      // Avoid negative and zero numbers, use 1e-15 http://bit.ly/2p5W29A
      const t = target[i];
      const o = output[i];
      error -= t * Math.log(Math.max(o, 1e-15)) +
        (1 - t) * Math.log(1 - Math.max(o, 1e-15));
    }

    return error / len;
  }
}
