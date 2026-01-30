import { assert } from "@std/assert";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("Custom cost function is called during evolution", async () => {
  console.log("Testing custom cost function during evolution...");

  const directory = ".test/customCost";
  Deno.mkdir(directory, { recursive: true });
  const touchFile = `${directory}/.touched`;

  try {
    // Clean up any existing touch file
    try {
      await Deno.remove(touchFile);
    } catch {
      // Ignore if file doesn't exist
    }

    // Create a simple creature
    const creature = new Creature(1, 1);

    // Create a simple dataset
    const dataSet: DataRecordInterface[] = [];
    for (let i = 0; i < 5; i++) {
      const input = [Math.random() * 2 - 1];
      dataSet.push({
        input: new Float32Array(input),
        output: new Float32Array([input[0] * 0.5]),
      });
    }

    // Test with custom cost function
    const options = {
      targetError: 0.05,
      log: 1,
      threads: 1, // Avoid worker init in test env
      verbose: true,
      iterations: 2, // Very short for testing
      customCost: {
        filePath: `${Deno.cwd()}/test/customCost/SimpleTouchTest.ts`,
      },
    };

    console.log("Starting evolution with custom cost function...");
    const result = await creature.evolveDataSet(dataSet, options);
    console.log("Evolution completed:", result);

    // Check if the touch file was created
    try {
      const fileInfo = await Deno.stat(touchFile);
      console.log("✅ Touch file was created at:", fileInfo.mtime);
      assert(fileInfo.size > 0, "Touch file should not be empty");
    } catch (error) {
      console.log("❌ Touch file was NOT created:", error);
      assert(
        false,
        "Custom cost function was not called - touch file not created",
      );
    }
  } finally {
    // Clean up
    try {
      await Deno.remove(touchFile);
    } catch {
      // Ignore cleanup errors
    }
  }
});
