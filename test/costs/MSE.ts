import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MSE } from "../../src/costs/MSE.ts";

Deno.test("MSE - getName returns MSE", () => {
  const mse = new MSE();
  assertEquals(mse.getName(), "MSE");
});

Deno.test("MSE - zero error when target equals output", () => {
  const mse = new MSE();
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([1.0, 2.0, 3.0]);
  const error = mse.calculate(target, output);
  assertAlmostEquals(error, 0, 1e-7);
});

Deno.test("MSE - known calculation", () => {
  const mse = new MSE();
  // MSE = (1/3) * ((1-0.5)^2 + (2-2.5)^2 + (3-3.5)^2)
  // = (1/3) * (0.25 + 0.25 + 0.25) = 0.25
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([0.5, 2.5, 3.5]);
  const error = mse.calculate(target, output);
  assertAlmostEquals(error, 0.25, 1e-6);
});

Deno.test("MSE - single element", () => {
  const mse = new MSE();
  const target = new Float32Array([5.0]);
  const output = new Float32Array([3.0]);
  // MSE = (5-3)^2 = 4
  const error = mse.calculate(target, output);
  assertAlmostEquals(error, 4.0, 1e-6);
});

Deno.test("MSE - penalises large errors more heavily", () => {
  const mse = new MSE();
  const target = new Float32Array([0.0]);
  const smallError = mse.calculate(target, new Float32Array([0.1]));
  const largeError = mse.calculate(target, new Float32Array([1.0]));
  // Large error should be disproportionately larger due to squaring
  // smallError = 0.01, largeError = 1.0 => 100x difference for 10x input
  assertEquals(largeError > smallError * 10, true);
});

Deno.test("MSE - symmetric", () => {
  const mse = new MSE();
  const a = new Float32Array([1.0, 2.0]);
  const b = new Float32Array([3.0, 4.0]);
  const error1 = mse.calculate(a, b);
  const error2 = mse.calculate(b, a);
  assertAlmostEquals(error1, error2, 1e-7);
});
