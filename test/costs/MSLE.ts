import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MSLE } from "../../src/costs/MSLE.ts";

Deno.test("MSLE - getName returns MSLE", () => {
  const msle = new MSLE();
  assertEquals(msle.getName(), "MSLE");
});

Deno.test("MSLE - zero error when target equals output", () => {
  const msle = new MSLE();
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([1.0, 2.0, 3.0]);
  const error = msle.calculate(target, output);
  assertAlmostEquals(error, 0, 1e-7);
});

Deno.test("MSLE - known calculation", () => {
  const msle = new MSLE();
  // MSLE uses: sum(log(target) - log(output))
  // For target=[1,1], output=[2,2]:
  // = (log(1) - log(2)) + (log(1) - log(2))
  // = (-0.6931...) + (-0.6931...) = -1.3862...
  const target = new Float32Array([1.0, 1.0]);
  const output = new Float32Array([2.0, 2.0]);
  const error = msle.calculate(target, output);
  assertAlmostEquals(error, -2 * Math.log(2), 1e-5);
});

Deno.test("MSLE - single element", () => {
  const msle = new MSLE();
  const target = new Float32Array([10.0]);
  const output = new Float32Array([10.0]);
  const error = msle.calculate(target, output);
  assertAlmostEquals(error, 0, 1e-7);
});

Deno.test("MSLE - handles small positive values", () => {
  const msle = new MSLE();
  // Uses epsilon 1e-15 to prevent log(0)
  const target = new Float32Array([0.001]);
  const output = new Float32Array([0.001]);
  const error = msle.calculate(target, output);
  assertAlmostEquals(error, 0, 1e-5);
});

Deno.test("MSLE - positive when target > output", () => {
  const msle = new MSLE();
  const target = new Float32Array([10.0]);
  const output = new Float32Array([1.0]);
  const error = msle.calculate(target, output);
  // log(10) - log(1) = log(10) > 0
  assertEquals(error > 0, true);
});
