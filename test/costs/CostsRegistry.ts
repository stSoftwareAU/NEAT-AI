import { assert, assertEquals, fail } from "@std/assert";
import { Costs } from "../../src/Costs.ts";
import type { CostInterface } from "../../src/costs/CostInterface.ts";

Deno.test("Costs.find - returns MSE instance", () => {
  const cost = Costs.find("MSE");
  assertEquals(cost.getName(), "MSE");
});

Deno.test("Costs.find - returns MAE instance", () => {
  const cost = Costs.find("MAE");
  assertEquals(cost.getName(), "MAE");
});

Deno.test("Costs.find - returns MAPE instance", () => {
  const cost = Costs.find("MAPE");
  assertEquals(cost.getName(), "MAPE");
});

Deno.test("Costs.find - returns MSLE instance", () => {
  const cost = Costs.find("MSLE");
  assertEquals(cost.getName(), "MSLE");
});

Deno.test("Costs.find - returns CROSS_ENTROPY instance", () => {
  const cost = Costs.find("CROSS_ENTROPY");
  assertEquals(cost.getName(), "CROSS_ENTROPY");
});

Deno.test("Costs.find - returns HINGE instance", () => {
  const cost = Costs.find("HINGE");
  assertEquals(cost.getName(), "HINGE");
});

Deno.test("Costs.find - throws for unknown cost", () => {
  try {
    Costs.find("NONEXISTENT");
    fail("Should throw for unknown cost function");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Unknown cost function"),
      true,
      `Error should mention unknown cost: ${(e as Error).message}`,
    );
  }
});

Deno.test("Costs.getAvailableCosts - includes all built-in costs", () => {
  const available = Costs.getAvailableCosts();
  assert(available.includes("MSE"), "Should include MSE");
  assert(available.includes("MAE"), "Should include MAE");
  assert(available.includes("MAPE"), "Should include MAPE");
  assert(available.includes("MSLE"), "Should include MSLE");
  assert(available.includes("CROSS_ENTROPY"), "Should include CROSS_ENTROPY");
  assert(available.includes("HINGE"), "Should include HINGE");
});

Deno.test("Costs.registerCustomCost - custom cost function can be registered and found", () => {
  const customCost: CostInterface = {
    getName: () => "TEST_CUSTOM_COST",
    calculate: (target: Float32Array, output: Float32Array): number => {
      let error = 0;
      for (let i = 0; i < target.length; i++) {
        error += Math.abs(target[i] - output[i]);
      }
      return error;
    },
  };

  Costs.registerCustomCost(customCost);
  const found = Costs.find("TEST_CUSTOM_COST");
  assertEquals(found.getName(), "TEST_CUSTOM_COST");

  // Verify it actually calculates
  const result = found.calculate(
    new Float32Array([1.0, 2.0]),
    new Float32Array([1.5, 2.5]),
  );
  assertEquals(result, 1.0);
});

Deno.test("Costs.registerCostFactory - registers a named factory", () => {
  Costs.registerCostFactory("TEST_REGISTER_FACTORY", () => ({
    getName: () => "TEST_REGISTER_FACTORY",
    calculate: (_t: Float32Array, _o: Float32Array): number => 42,
  }));

  const found = Costs.find("TEST_REGISTER_FACTORY");
  assertEquals(found.getName(), "TEST_REGISTER_FACTORY");
  assertEquals(
    found.calculate(new Float32Array([0]), new Float32Array([0])),
    42,
  );
});

Deno.test("Costs.getAvailableCosts - includes custom costs after registration", () => {
  Costs.registerCostFactory("AVAILABLE_TEST_COST", () => ({
    getName: () => "AVAILABLE_TEST_COST",
    calculate: (_t: Float32Array, _o: Float32Array): number => 0,
  }));

  const available = Costs.getAvailableCosts();
  assert(
    available.includes("AVAILABLE_TEST_COST"),
    "Should include registered factory cost",
  );
});

Deno.test("Costs.find - each call returns a fresh instance from registry", () => {
  const cost1 = Costs.find("MSE");
  const cost2 = Costs.find("MSE");
  // They should be separate instances
  assertEquals(cost1.getName(), cost2.getName());
  assertEquals(cost1 !== cost2, true, "Should return separate instances");
});
