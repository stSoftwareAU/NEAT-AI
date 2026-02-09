import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MAE } from "../../src/costs/MAE.ts";

Deno.test("MAE - getName returns MAE", () => {
  const mae = new MAE();
  assertEquals(mae.getName(), "MAE");
});

Deno.test("MAE - zero error when target equals output", () => {
  const mae = new MAE();
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([1.0, 2.0, 3.0]);
  const error = mae.calculate(target, output);
  assertAlmostEquals(error, 0, 1e-7);
});

Deno.test("MAE - known calculation", () => {
  const mae = new MAE();
  // MAE = (1/3) * (|1-0.5| + |2-2.5| + |3-3.5|) = (1/3) * (0.5 + 0.5 + 0.5) = 0.5
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([0.5, 2.5, 3.5]);
  const error = mae.calculate(target, output);
  assertAlmostEquals(error, 0.5, 1e-6);
});

Deno.test("MAE - single element", () => {
  const mae = new MAE();
  const target = new Float32Array([5.0]);
  const output = new Float32Array([3.0]);
  // MAE = |5-3| = 2
  const error = mae.calculate(target, output);
  assertAlmostEquals(error, 2.0, 1e-6);
});

Deno.test("MAE - symmetric", () => {
  const mae = new MAE();
  const a = new Float32Array([1.0, 2.0]);
  const b = new Float32Array([3.0, 4.0]);
  const error1 = mae.calculate(a, b);
  const error2 = mae.calculate(b, a);
  assertAlmostEquals(error1, error2, 1e-7);
});

Deno.test("MAE - negative values", () => {
  const mae = new MAE();
  const target = new Float32Array([-1.0, -2.0]);
  const output = new Float32Array([1.0, 2.0]);
  // MAE = (1/2) * (|-1-1| + |-2-2|) = (1/2) * (2 + 4) = 3
  const error = mae.calculate(target, output);
  assertAlmostEquals(error, 3.0, 1e-6);
});
