import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CostInterface } from "../src/Costs.ts";

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

  // Create training data where we want to minimize error on first output more than second
  const trainingData = [
    { input: [0.1], target: [0.5, 0.2] },
    { input: [0.3], target: [0.7, 0.4] },
    { input: [0.5], target: [0.9, 0.6] },
  ];

  // Create a simple dataset file for testing
  const datasetDir = "./test/custom_cost_data";
  try {
    await Deno.mkdir(datasetDir, { recursive: true });

    // Write training data to file
    const dataContent = trainingData.map((item) =>
      `${item.input.join(",")},${item.target.join(",")}`
    ).join("\n");

    await Deno.writeTextFile(`${datasetDir}/train.csv`, dataContent);

    // Test that the custom cost function works correctly
    const target1 = new Float32Array([0.5, 0.2]);
    const actual1 = new Float32Array([0.4, 0.3]); // First output has smaller error, second has larger error

    const error1 = customCost.calculate(target1, actual1);
    // Expected: 3.0 * (0.5-0.4)² + 1.0 * (0.2-0.3)² = 3.0 * 0.01 + 1.0 * 0.01 = 0.04
    assertAlmostEquals(
      error1,
      0.04,
      1e-8,
      "Custom cost calculation should weight first output more heavily",
    );

    // Create a creature and test the file path approach
    const _creature = new Creature(1, 2);

    // Note: In a real scenario, the external cost function would be in a separate file
    // For this test, we're just demonstrating the API
    console.log("Example usage:");
    console.log("creature.evolveDir(datasetDir, {");
    console.log("  customCost: { filePath: './my-custom-cost.ts' }");
    console.log("});");

    // Test that the custom cost function works correctly
    const testTarget = new Float32Array([0.5, 0.2]);
    const testOutput = new Float32Array([0.4, 0.3]);
    const testError = customCost.calculate(testTarget, testOutput);
    assertAlmostEquals(
      testError,
      0.04,
      1e-8,
      "Custom cost should produce correct result",
    );
  } finally {
    // Clean up test data
    try {
      await Deno.remove(datasetDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
