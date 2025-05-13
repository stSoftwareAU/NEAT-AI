import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new ReLU();
  const act = squashFunction.squash(currentValue);
  const target = squashFunction.squash(targetValue);

  const slope = squashFunction.derivative!(currentValue);
  const expectedError = (target - act) / slope;

  const error = squashFunction.calculateError!(act, target, currentValue);

  assert(Number.isFinite(error));
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Expected ${expectedError}, got ${error}`,
  );
}

Deno.test("ReLU.calculateError: active region", () => {
  check(1.0, 1.0);
  check(0.5, 1.0);
  check(1.5, 1);
});

Deno.test("ReLU.calculateError: inactive region", () => {
  const relu = new ReLU();

  assertEquals(relu.calculateError(0.0, 0.0, relu.unSquash(0)), 0.0);
  assertEquals(relu.calculateError(0.0, 1.0, relu.unSquash(0)), 1.0);
  assertEquals(relu.calculateError(0.0, 0.5, relu.unSquash(0)), 0.5);
});

Deno.test("ReLU.calculateError: flat region with hint", () => {
  const relu = new ReLU();

  // currentActivation = 0 → from raw = -10
  // targetActivation = 1 → from raw = 1
  const error = relu.calculateError(0.0, 1.0, -10);
  assertEquals(error, 11.0);
});
