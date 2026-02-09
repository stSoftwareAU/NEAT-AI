import { assertEquals, fail } from "@std/assert";
import { CrossEntropy } from "../../src/costs/CrossEntropy.ts";

Deno.test("CrossEntropy - getName returns CROSS_ENTROPY", () => {
  const ce = new CrossEntropy();
  assertEquals(ce.getName(), "CROSS_ENTROPY");
});

Deno.test("CrossEntropy - low error for correct confident predictions", () => {
  const ce = new CrossEntropy();
  const target = new Float32Array([1.0, 0.0, 1.0]);
  const output = new Float32Array([0.99, 0.01, 0.99]);
  const error = ce.calculate(target, output);
  // Should be a small positive number
  assertEquals(error > 0, true);
  assertEquals(error < 0.1, true);
});

Deno.test("CrossEntropy - higher error for wrong predictions", () => {
  const ce = new CrossEntropy();
  const target = new Float32Array([1.0, 0.0]);

  const goodOutput = new Float32Array([0.9, 0.1]);
  const badOutput = new Float32Array([0.1, 0.9]);

  const goodError = ce.calculate(target, goodOutput);
  const badError = ce.calculate(target, badOutput);

  assertEquals(
    badError > goodError,
    true,
    "Wrong predictions should have higher error",
  );
});

Deno.test("CrossEntropy - single element perfect prediction", () => {
  const ce = new CrossEntropy();
  const target = new Float32Array([1.0]);
  const output = new Float32Array([0.999]);
  const error = ce.calculate(target, output);
  assertEquals(error > 0, true);
  assertEquals(error < 0.01, true);
});

Deno.test("CrossEntropy - rejects output outside 0-1 range", () => {
  const ce = new CrossEntropy();
  const target = new Float32Array([1.0]);
  const output = new Float32Array([1.5]);
  try {
    ce.calculate(target, output);
    fail("Should throw for output > 1");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("outside [0,1]"),
      true,
      `Error should mention out of range: ${(e as Error).message}`,
    );
  }
});

Deno.test("CrossEntropy - rejects negative output", () => {
  const ce = new CrossEntropy();
  const target = new Float32Array([0.0]);
  const output = new Float32Array([-0.1]);
  try {
    ce.calculate(target, output);
    fail("Should throw for output < 0");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("outside [0,1]"),
      true,
      `Error should mention out of range: ${(e as Error).message}`,
    );
  }
});

Deno.test("CrossEntropy - handles edge values near 0 and 1", () => {
  const ce = new CrossEntropy();
  // Output very close to 0 and 1 should be clamped and not produce NaN
  const target = new Float32Array([0.0, 1.0]);
  const output = new Float32Array([0.0000001, 0.9999999]);
  const error = ce.calculate(target, output);
  assertEquals(Number.isFinite(error), true, "Error should be finite");
  assertEquals(error >= 0, true, "Error should be non-negative");
});
