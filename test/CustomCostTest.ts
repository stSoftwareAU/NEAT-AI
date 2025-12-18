import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CostInterface } from "../src/costs/CostInterface.ts";

class CustomWeightedCost implements CostInterface {
  public static readonly NAME = "CustomWeightedCost";
  private weights: number[];

  constructor(weights: number[]) {
    this.weights = weights;
  }

  getName(): string {
    return CustomWeightedCost.NAME;
  }

  calculate(target: Float32Array, output: Float32Array): number {
    if (
      target.length !== output.length || target.length !== this.weights.length
    ) {
      throw new Error(
        `Mismatch in array lengths: target=${target.length}, output=${output.length}, weights=${this.weights.length}`,
      );
    }

    let totalError = 0;
    for (let i = 0; i < target.length; i++) {
      const error = target[i] - output[i];
      totalError += this.weights[i] * error * error;
    }

    return totalError;
  }
}

Deno.test("Custom cost function with weighted outputs", async () => {
  // Set up a custom cost function that weights the first output 3x more than the second
  const customCost = new CustomWeightedCost([3.0, 1.0]);

  // Create a simple dataset file for testing
  const datasetDir = "./test/custom_cost_data";
  try {
    await Deno.mkdir(datasetDir, { recursive: true });
    await Deno.writeTextFile(`${datasetDir}/train.csv`, "0.1,0.5,0.2\n");

    // Test that the custom cost function works correctly
    const target1 = new Float32Array([0.5, 0.2]);
    const actual1 = new Float32Array([0.4, 0.3]);

    const error1 = customCost.calculate(target1, actual1);
    // Expected: 3.0 * (0.5-0.4)² + 1.0 * (0.2-0.3)² = 0.04
    assertAlmostEquals(error1, 0.04, 1e-8);

    // Demonstrate the public API shape (no runtime assertion here).
    const _creature = new Creature(1, 2);
    void _creature;
  } finally {
    try {
      await Deno.remove(datasetDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
