import type { CostInterface } from "../mod.ts";

/**
 * Example external cost function that could be in a separate project.
 * This file would be in the external program's codebase.
 * 
 * Requirements:
 * 1. Must implement CostInterface
 * 2. Must have a parameterless constructor
 * 3. Must implement getName() method
 * 4. Must be the default export or the only export
 */

export class MyCustomCost implements CostInterface {
  getName(): string {
    return "MyCustomCost";
  }

  calculate(target: Float32Array, output: Float32Array): number {
    let totalError = 0;
    for (let i = output.length; i--;) {
      const error = target[i] - output[i];
      // Custom calculation logic here
      totalError += error * error;
    }
    return totalError;
  }
}

// Default export for the library to use
export default MyCustomCost; 