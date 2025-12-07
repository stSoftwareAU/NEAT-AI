import { assert, assertEquals, assertThrows } from "@std/assert";
import { Costs } from "../src/Costs.ts";
import type { CostInterface } from "../src/costs/CostInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("calculate cost", () => {
  const checks = [
    { target: [0.8], output: [1.9] },
    { target: [0.8], output: [1] },
    { target: [0.8], output: [0.9] },
    { target: [0.9], output: [0.8] },
    { target: [-0.8], output: [-0.9] },
    { target: [-0.9], output: [-0.8] },

    { target: [0.5], output: [0.5] },
    { target: [-0.5], output: [0.5] },
  ];

  const names = [
    "CROSS_ENTROPY",
    "HINGE",
    "MAE",
    "MAPE",
    "MSE",
    "MSLE",
  ];

  checks.forEach((check) => {
    for (let i = names.length; i--;) {
      const name = names[i];
      if (
        name === "CROSS_ENTROPY" && (check.output[0] < 0 || check.output[0] > 1)
      ) {
        continue;
      }
      const r = Costs.find(name).calculate(
        new Float32Array(check.target),
        new Float32Array(check.output),
      );

      console.info(name, check, r);
    }
  });
});

Deno.test("Costs.getAvailableCosts - should return all predefined cost functions", () => {
  const availableCosts = Costs.getAvailableCosts();

  // Should contain all predefined cost functions
  assert(
    availableCosts.includes("CROSS_ENTROPY"),
    "Should include CROSS_ENTROPY",
  );
  assert(availableCosts.includes("MSE"), "Should include MSE");
  assert(availableCosts.includes("MAE"), "Should include MAE");
  assert(availableCosts.includes("MAPE"), "Should include MAPE");
  assert(availableCosts.includes("MSLE"), "Should include MSLE");
  assert(availableCosts.includes("HINGE"), "Should include HINGE");

  // Should have at least 6 cost functions
  assert(availableCosts.length >= 6, "Should have at least 6 cost functions");
});

Deno.test("Costs.find - should throw error for unknown cost function", () => {
  assertThrows(
    () => {
      Costs.find("UNKNOWN_COST_FUNCTION");
    },
    Error,
    "Unknown cost function: UNKNOWN_COST_FUNCTION",
  );
});

Deno.test("Costs.registerCustomCost - should register and find custom cost function", () => {
  // Create a custom cost function
  const customCost: CostInterface = {
    getName: () => "CUSTOM_TEST_COST",
    calculate: (target: Float32Array, output: Float32Array): number => {
      // Simple custom calculation
      let sum = 0;
      for (let i = 0; i < target.length; i++) {
        sum += Math.abs(target[i] - output[i]) * 2;
      }
      return sum;
    },
  };

  // Register the custom cost
  Costs.registerCustomCost(customCost);

  // Should be able to find the custom cost
  const found = Costs.find("CUSTOM_TEST_COST");
  assertEquals(found.getName(), "CUSTOM_TEST_COST");

  // Should calculate correctly
  const result = found.calculate(
    new Float32Array([1.0]),
    new Float32Array([0.5]),
  );
  assertEquals(result, 1.0); // |1.0 - 0.5| * 2 = 1.0

  // Should be included in available costs
  const availableCosts = Costs.getAvailableCosts();
  assert(
    availableCosts.includes("CUSTOM_TEST_COST"),
    "Should include custom cost",
  );
});

Deno.test("Costs.register - should register cost function using getName()", () => {
  // Create a cost function class
  class TestCost implements CostInterface {
    getName(): string {
      return "TEST_REGISTERED_COST";
    }
    calculate(target: Float32Array, output: Float32Array): number {
      let sum = 0;
      for (let i = 0; i < target.length; i++) {
        sum += (target[i] - output[i]) ** 2 * 3;
      }
      return sum;
    }
  }

  // Register using the instance
  const testCost = new TestCost();
  Costs.register(testCost);

  // Should be able to find it
  const found = Costs.find("TEST_REGISTERED_COST");
  assertEquals(found.getName(), "TEST_REGISTERED_COST");

  // Each call should return a new instance
  const found2 = Costs.find("TEST_REGISTERED_COST");
  assert(found !== found2, "Should return different instances");
});

Deno.test("Costs.registerCostFactory - should register and use factory function", () => {
  let factoryCallCount = 0;

  // Create a factory function
  const factory = (): CostInterface => {
    factoryCallCount++;
    return {
      getName: () => "FACTORY_COST",
      calculate: (target: Float32Array, output: Float32Array): number => {
        let sum = 0;
        for (let i = 0; i < target.length; i++) {
          sum += Math.abs(target[i] - output[i]);
        }
        return sum;
      },
    };
  };

  // Register the factory
  Costs.registerCostFactory("FACTORY_COST", factory);

  // First call should invoke factory
  const cost1 = Costs.find("FACTORY_COST");
  assertEquals(factoryCallCount, 1);
  assertEquals(cost1.getName(), "FACTORY_COST");

  // Second call should also invoke factory (new instance each time)
  const _cost2 = Costs.find("FACTORY_COST");
  assertEquals(factoryCallCount, 2);
  assert(_cost2, "Second factory call should return a cost");

  // Should calculate correctly
  const result = cost1.calculate(
    new Float32Array([1.0, 2.0]),
    new Float32Array([0.5, 1.5]),
  );
  assertEquals(result, 1.0); // |1.0 - 0.5| + |2.0 - 1.5| = 0.5 + 0.5 = 1.0
});

Deno.test("Costs.find - should return same custom cost instance", () => {
  // Custom costs are pre-instantiated, so should return same instance
  const customCost: CostInterface = {
    getName: () => "SAME_INSTANCE_COST",
    calculate: () => 0,
  };

  Costs.registerCustomCost(customCost);

  const found1 = Costs.find("SAME_INSTANCE_COST");
  const found2 = Costs.find("SAME_INSTANCE_COST");

  // Custom costs should return the same instance
  assertEquals(found1, found2, "Custom costs should return same instance");
});
