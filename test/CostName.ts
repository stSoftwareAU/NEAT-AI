import { assertEquals } from "@std/assert";
import {
  BUILT_IN_COST_NAMES,
  type BuiltInCostName,
  type CostName,
} from "../src/Costs.ts";

Deno.test("BUILT_IN_COST_NAMES - should stay in sync with supported costs", () => {
  assertEquals(BUILT_IN_COST_NAMES, [
    "CROSS_ENTROPY",
    "MSE",
    "MAE",
    "MAPE",
    "MSLE",
    "HINGE",
  ]);
});

Deno.test("CostName types - should expose strict built-in union plus custom escape hatch", () => {
  const builtIn: BuiltInCostName = "MSE";
  const costName: CostName = builtIn;

  // This is the key behaviour: strict union for built-ins.
  // @ts-expect-error - not a built-in cost name
  const _badBuiltIn: BuiltInCostName = "NOT_A_REAL_COST";

  // CostName is intentionally restricted to built-ins.
  // @ts-expect-error - CostName only accepts built-in cost names
  const _custom: CostName = "CUSTOM_USER_COST";

  // Use variables so deno doesn't complain about unused declarations in future stricter configs.
  void costName;
  void _custom;
});
