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

/**
 * Interface for cost functions used in neural network training.
 * Defines the contract for calculating error between target and output values.
 */
export interface CostInterface {
  /**
   * Calculates the cost/error between target and output values.
   * 
   * @param target - The expected output values
   * @param output - The actual output values from the neural network
   * @returns The calculated cost/error value
   */
  calculate(target: Float32Array, output: Float32Array): number;
}

/**
 * Factory class for creating cost function instances.
 * Provides access to various loss functions used in neural network training.
 */
export class Costs {
  /**
   * Finds and returns a cost function instance by name.
   * 
   * @param name - The name of the cost function to retrieve
   * @returns A cost function instance implementing CostInterface
   * @throws {Error} When an unknown cost function name is provided
   */
  static find(name: string): CostInterface {
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
