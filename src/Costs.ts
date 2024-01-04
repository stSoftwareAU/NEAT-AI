/*******************************************************************************
 **                                  COST FUNCTIONS
 ** https://en.wikipedia.org/wiki/Loss_function
 *******************************************************************************/

import { BINARY } from "./costs/BINARY.ts";
import { CrossEntropy } from "./costs/CrossEntropy.ts";
import { HINGE } from "./costs/HINGE.ts";
import { MAE } from "./costs/MAE.ts";
import { MAPE } from "./costs/MAPE.ts";
import { MSE } from "./costs/MSE.ts";
import { MSELimit } from "./costs/MSELimit.ts";
import { MSLE } from "./costs/MSLE.ts";
import { TwelveSteps } from "./costs/TwelveSteps.ts";

export interface CostInterface {
  calculate(target: number[], output: number[]): number;
}

export class Costs {
  static find(name: string) {
    switch (name) {
      /** Cross entropy error */
      case "CROSS_ENTROPY":
        return new CrossEntropy();
      /** Mean Squared Error */
      case "MSE":
        return new MSE();
      case "MSELimit":
        return new MSELimit();
      /** Binary error */
      case "BINARY":
        return new BINARY();
      /** Mean Absolute Error */
      case "MAE":
        return new MAE();
      /** Mean Absolute Percentage Error */
      case "MAPE":
        return new MAPE();
      /** Mean Squared Logarithmic Error */
      case "MSLE":
        return new MSLE();
      /** Hinge loss, for classifiers */
      case "HINGE":
        return new HINGE();
      /** Twelve steps Error */
      case "12STEPS":
        return new TwelveSteps();
      default:
        throw new Error(`Unknown: ${name}`);
    }
  }
}
