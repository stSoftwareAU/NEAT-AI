import { Creature } from "../mod.ts";

/**
 * Example: External program using file path-based custom cost functions
 *
 * This demonstrates how external programs can provide custom cost functions
 * by simply pointing to a file, without needing to register constructors.
 */

function main() {
  console.log("File-Based Custom Cost Function Example");
  console.log("======================================");

  // Create a creature (for demonstration purposes)
  const _creature = new Creature(1, 2); // 1 input, 2 outputs

  // Example 1: Using a file path to a custom cost function
  console.log("\nExample 1: File path-based custom cost");
  console.log("External program would call:");
  console.log("creature.evolveDir(TRAINING_DATA_DIR, {");
  console.log("  customCost: {");
  console.log("    filePath: './my-custom-cost.ts'");
  console.log("  },");
  console.log("  // ... other options");
  console.log("});");

  // Example 2: Using standard cost functions
  console.log("\nExample 2: Standard cost functions");
  console.log("creature.evolveDir(TRAINING_DATA_DIR, {");
  console.log("  costName: 'MSE',");
  console.log("  // ... other options");
  console.log("});");

  console.log("\n=== How It Works ===");
  console.log("1. External program provides file path");
  console.log("2. Library dynamically imports the file in worker threads");
  console.log("3. Library creates an instance of the cost function");
  console.log("4. Library calls getName() to get the cost function name");
  console.log("5. No need for className, data, or serialization!");

  console.log("\n=== Benefits ===");
  console.log("✅ No serialization/deserialization needed");
  console.log("✅ No constructor registration required");
  console.log("✅ No className or data parameters needed");
  console.log("✅ Works with any external cost function");
  console.log("✅ Simple file path-based approach");
  console.log("✅ Supports both named and default exports");

  console.log("\n=== External Cost Function Requirements ===");
  console.log("1. Must implement CostInterface");
  console.log("2. Must have a default export or be the only export");
  console.log("3. Must have a parameterless constructor");
  console.log("4. Must implement getName() method");

  console.log("\nExample completed successfully!");
}

if (import.meta.main) {
  main();
}
