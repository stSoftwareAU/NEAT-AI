import { assert, assertAlmostEquals } from "@std/assert";
import { SELU } from "../../../src/methods/activations/types/SELU.ts";

function checkDerivativePath(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new SELU();
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

Deno.test("SELU.calculateError: positive region", () => {
  checkDerivativePath(1.0, 2);
});

Deno.test("SELU.calculateError: negative region", () => {
  checkDerivativePath(-1.0, -0.5);
});

Deno.test("SELU.calculateError: fallback at low x", () => {
  // At x=-10, derivative ≈ SCALE * ALPHA * exp(-10) ≈ 8e-5 which is below
  // the vanishing gradient threshold (1e-2). The fallback uses unSquash
  // to compute targetInput - currentInput instead of rawError / slope.
  // This prevents exploding errors. See issue #1588.
  const selu = new SELU();
  const currentValue = -10;
  const targetValue = -9.9;
  const act = selu.squash(currentValue);
  const target = selu.squash(targetValue);

  const error = selu.calculateError(act, target, currentValue);

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  // unSquash-based error: targetInput - currentInput ≈ -9.9 - (-10) = 0.1
  assertAlmostEquals(error, targetValue - currentValue, 0.01);
});

Deno.test("SELU.calculateError: perfect match", () => {
  const selu = new SELU();
  const val = selu.squash(-0.5);
  const error = selu.calculateError(val, val, -0.5);
  assertAlmostEquals(error, 0, 1e-10);
});
