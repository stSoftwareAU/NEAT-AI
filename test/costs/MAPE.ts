import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MAPE } from "../../src/costs/MAPE.ts";

Deno.test("MAPE - getName returns MAPE", () => {
  const mape = new MAPE();
  assertEquals(mape.getName(), "MAPE");
});

Deno.test("MAPE - zero error when target equals output", () => {
  const mape = new MAPE();
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([1.0, 2.0, 3.0]);
  const error = mape.calculate(target, output);
  assertAlmostEquals(error, 0, 1e-7);
});

Deno.test("MAPE - known calculation", () => {
  const mape = new MAPE();
  // MAPE = (1/3) * (|(0.9-1)/1| + |(2.1-2)/2| + |(2.85-3)/3|)
  // = (1/3) * (0.1 + 0.05 + 0.05) = 0.0666...
  const target = new Float32Array([1.0, 2.0, 3.0]);
  const output = new Float32Array([0.9, 2.1, 2.85]);
  const error = mape.calculate(target, output);
  assertAlmostEquals(error, 0.0667, 0.001);
});

Deno.test("MAPE - single element", () => {
  const mape = new MAPE();
  const target = new Float32Array([100.0]);
  const output = new Float32Array([90.0]);
  // MAPE = |(90-100)/100| = 0.1
  const error = mape.calculate(target, output);
  assertAlmostEquals(error, 0.1, 1e-6);
});

Deno.test("MAPE - large values", () => {
  const mape = new MAPE();
  const target = new Float32Array([1000.0]);
  const output = new Float32Array([900.0]);
  // MAPE = |(900-1000)/1000| = 0.1 (same relative error)
  const error = mape.calculate(target, output);
  assertAlmostEquals(error, 0.1, 1e-6);
});

Deno.test("MAPE - scale independence", () => {
  const mape = new MAPE();
  // Same relative error at different scales should give similar MAPE
  const error1 = mape.calculate(
    new Float32Array([10.0]),
    new Float32Array([9.0]),
  );
  const error2 = mape.calculate(
    new Float32Array([1000.0]),
    new Float32Array([900.0]),
  );
  assertAlmostEquals(error1, error2, 1e-6);
});
