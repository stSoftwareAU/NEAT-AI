import { fail } from "@std/assert";
import type { CostInterface } from "../Costs.ts";

/** Cross entropy error */
export class CrossEntropy implements CostInterface {
  static readonly NAME = "CROSS_ENTROPY";

  getName(): string {
    return CrossEntropy.NAME;
  }

  calculate(target: Float32Array, output: Float32Array): number {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];
      let o = output[i];

      // Clamp o to [1e-15, 1 - 1e-15], warn if out-of-bounds
      if (o < 0 || o > 1) {
        fail(`CrossEntropy: output[${i}] = ${o} is outside [0,1]`);
      }

      o = Math.min(Math.max(o, 1e-15), 1 - 1e-15);

      error -= t * Math.log(o) + (1 - t) * Math.log(1 - o);
    }

    return error / len;
  }
}
