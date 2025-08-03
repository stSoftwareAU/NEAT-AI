import { type CostInterface, Creature } from "../mod.ts";

/**
 * Example custom cost function that weights different outputs differently.
 * This demonstrates how external programs can create custom cost functions.
 */
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
    let totalError = 0;
    for (let i = output.length; i--;) {
      const error = target[i] - output[i];
      const weight = i < this.weights.length ? this.weights[i] : 1;
      totalError += weight * error * error;
    }
    return totalError;
  }
}

/**
 * Example custom cost function that gives extra weight to the 5th element.
 * This demonstrates a more specialized cost function.
 */
class FifthElementWeightedCost implements CostInterface {
  public static readonly NAME = "FifthElementWeightedCost";
  private readonly fifthElementWeight: number;

  constructor(fifthElementWeight: number = 12) {
    this.fifthElementWeight = fifthElementWeight;
  }

  getName(): string {
    return FifthElementWeightedCost.NAME;
  }

  calculate(target: Float32Array, output: Float32Array): number {
    let totalError = 0;
    for (let i = output.length; i--;) {
      const error = target[i] - output[i];
      const weight = i === 4 ? this.fifthElementWeight : 1; // 5th element (index 4) gets special weight
      totalError += weight * error * error;
    }
    return totalError;
  }
}

function main() {
  console.log("Custom Cost Function Example");
  console.log("============================");

  // Create a creature (for demonstration purposes)
  const _creature = new Creature(1, 2); // 1 input, 2 outputs

  // Create custom cost functions (for demonstration purposes)
  const _customCost = new CustomWeightedCost([3.0, 1.0]); // Weight first output 3x more
  const fifthElementCost = new FifthElementWeightedCost(12); // Weight 5th element by 12

  console.log("Example 1: General weighted cost function");
  console.log("Custom cost function weights:", [3.0, 1.0]);

  console.log("\nExample 2: Fifth element weighted by 12");
  console.log("Fifth element cost function weight:", 12);

  // Test the custom cost functions directly
  const target = new Float32Array([0.5, 0.2, 0.3, 0.4, 0.1, 0.6]);
  const output1 = new Float32Array([0.4, 0.3, 0.3, 0.4, 0.2, 0.6]); // 5th element has error
  const output2 = new Float32Array([0.3, 0.1, 0.3, 0.4, 0.1, 0.6]); // 5th element correct

  const error1 = fifthElementCost.calculate(target, output1);
  const error2 = fifthElementCost.calculate(target, output2);

  console.log(`\nTarget: [${target.join(", ")}]`);
  console.log(
    `Output 1 (5th element wrong): [${output1.join(", ")}] - Error: ${
      error1.toFixed(4)
    }`,
  );
  console.log(
    `Output 2 (5th element correct): [${output2.join(", ")}] - Error: ${
      error2.toFixed(4)
    }`,
  );
  console.log(
    `Difference: ${
      (error1 - error2).toFixed(4)
    } (5th element error weighted by 12)`,
  );

  // Example of how external programs would use custom cost functions
  console.log("\n=== External Program Usage Example ===");
  console.log("External programs would call:");
  console.log("creature.evolveDir(TRAINING_DATA_DIR, {");
  console.log("  customCost: { filePath: './my-custom-cost.ts' },");
  console.log("  // ... other options");
  console.log("});");

  console.log("\nOr for standard cost functions:");
  console.log("creature.evolveDir(TRAINING_DATA_DIR, {");
  console.log("  costName: 'MSE',");
  console.log("  // ... other options");
  console.log("});");

  console.log("\nThe library automatically:");
  console.log("1. Loads the custom cost function from the file path");
  console.log("2. Passes it to worker threads");
  console.log("3. Uses it for all evaluations and training");
  console.log("4. No serialization/deserialization needed!");

  console.log("\nExample completed successfully!");
}

if (import.meta.main) {
  main();
}
