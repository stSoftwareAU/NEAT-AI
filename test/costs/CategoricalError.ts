import { assertEquals } from "@std/assert";
import { CategoricalError } from "@costs/CategoricalError.ts";
import { Costs } from "@costs";

Deno.test("CategoricalError - getName returns CATEGORICAL_ERROR", () => {
  const cost = new CategoricalError();
  assertEquals(cost.getName(), "CATEGORICAL_ERROR");
});

Deno.test("CategoricalError - registered as a built-in cost", () => {
  const cost = Costs.find("CATEGORICAL_ERROR");
  assertEquals(cost.getName(), "CATEGORICAL_ERROR");
  assertEquals(Costs.getAvailableCosts().includes("CATEGORICAL_ERROR"), true);
});

Deno.test("CategoricalError - correct argmax prediction scores 0", () => {
  const cost = new CategoricalError();
  const target = new Float32Array([0, 1, 0]); // true class = 1
  const output = new Float32Array([0.2, 0.7, 0.1]); // predicted class = 1
  assertEquals(cost.calculate(target, output), 0);
});

Deno.test("CategoricalError - incorrect argmax prediction scores 1", () => {
  const cost = new CategoricalError();
  const target = new Float32Array([0, 1, 0]); // true class = 1
  const output = new Float32Array([0.6, 0.3, 0.1]); // predicted class = 0
  assertEquals(cost.calculate(target, output), 1);
});

Deno.test("CategoricalError - trivial one-hot MSE floor is exposed as full error", () => {
  // A constant classifier always predicts class 0 regardless of the true
  // class. MSE would report a low ~0.1 floor; CategoricalError reports the
  // true misclassification rate. Averaging the per-record 0/1 results over a
  // balanced ten-class set gives 0.9 (chance accuracy = 10%).
  const cost = new CategoricalError();
  const classes = 10;
  let total = 0;
  for (let trueClass = 0; trueClass < classes; trueClass++) {
    const target = new Float32Array(classes);
    target[trueClass] = 1;
    // Constant output: always strongest at index 0.
    const output = new Float32Array(classes).fill(0.05);
    output[0] = 0.55;
    total += cost.calculate(target, output);
  }
  const averageError = total / classes;
  assertEquals(averageError, 0.9); // 9 of 10 classes misclassified
});

Deno.test("CategoricalError - perfect classifier scores 0 across all classes", () => {
  const cost = new CategoricalError();
  const classes = 4;
  let total = 0;
  for (let trueClass = 0; trueClass < classes; trueClass++) {
    const target = new Float32Array(classes);
    target[trueClass] = 1;
    const output = new Float32Array(classes).fill(0.1);
    output[trueClass] = 0.9; // predicts the correct class
    total += cost.calculate(target, output);
  }
  assertEquals(total / classes, 0);
});

Deno.test("CategoricalError - ties resolve to the first index", () => {
  const cost = new CategoricalError();
  const target = new Float32Array([1, 0, 0]); // true class = 0
  // Outputs tie between index 0 and 2; argmax picks the first (index 0).
  const output = new Float32Array([0.5, 0.0, 0.5]);
  assertEquals(cost.calculate(target, output), 0);
});

Deno.test("CategoricalError - empty arrays return 0", () => {
  const cost = new CategoricalError();
  assertEquals(
    cost.calculate(new Float32Array(0), new Float32Array(0)),
    0,
  );
});

Deno.test("CategoricalError - single output is always counted correct", () => {
  // Documented limitation: with one output the argmax is always index 0.
  const cost = new CategoricalError();
  assertEquals(
    cost.calculate(new Float32Array([1]), new Float32Array([0.0])),
    0,
  );
});
