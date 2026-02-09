import { assertAlmostEquals, assertEquals } from "@std/assert";
import { HINGE } from "../../src/costs/HINGE.ts";

Deno.test("HINGE - getName returns HINGE", () => {
  const hinge = new HINGE();
  assertEquals(hinge.getName(), "HINGE");
});

Deno.test("HINGE - zero loss for correct confident predictions", () => {
  const hinge = new HINGE();
  // Correct classification with margin >= 1
  const target = new Float32Array([1.0, -1.0]);
  const output = new Float32Array([2.0, -2.0]);
  const error = hinge.calculate(target, output);
  // max(0, 1 - 1*2) + max(0, 1 - (-1)*(-2)) = max(0,-1) + max(0,-1) = 0
  assertAlmostEquals(error, 0, 1e-7);
});

Deno.test("HINGE - known calculation", () => {
  const hinge = new HINGE();
  // target=1, output=0.5: max(0, 1 - 1*0.5) = 0.5
  // target=-1, output=-0.3: max(0, 1 - (-1)*(-0.3)) = max(0, 1-0.3) = 0.7
  const target = new Float32Array([1.0, -1.0]);
  const output = new Float32Array([0.5, -0.3]);
  const error = hinge.calculate(target, output);
  assertAlmostEquals(error, 1.2, 1e-6);
});

Deno.test("HINGE - single element", () => {
  const hinge = new HINGE();
  const target = new Float32Array([1.0]);
  const output = new Float32Array([0.0]);
  // max(0, 1 - 1*0) = 1
  const error = hinge.calculate(target, output);
  assertAlmostEquals(error, 1.0, 1e-7);
});

Deno.test("HINGE - misclassification produces larger loss", () => {
  const hinge = new HINGE();
  const target = new Float32Array([1.0]);

  const correctOutput = new Float32Array([2.0]);
  const wrongOutput = new Float32Array([-1.0]);

  const correctLoss = hinge.calculate(target, correctOutput);
  const wrongLoss = hinge.calculate(target, wrongOutput);

  assertEquals(
    wrongLoss > correctLoss,
    true,
    "Misclassification should have higher loss",
  );
});

Deno.test("HINGE - always non-negative", () => {
  const hinge = new HINGE();
  const target = new Float32Array([1.0, -1.0, 1.0]);
  const output = new Float32Array([100.0, -100.0, 50.0]);
  const error = hinge.calculate(target, output);
  assertEquals(error >= 0, true, "Hinge loss should be non-negative");
});
