import { assert, assertAlmostEquals } from "@std/assert";
import { ELU } from "../../../src/methods/activations/types/ELU.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

function checkDerivativePath(
  squashFunction: ActivationInterface,
  currentValue: number,
  targetValue: number,
) {
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

Deno.test("ELU.calculateError: positive region", () => {
  const squashFunction = new ELU();

  checkDerivativePath(squashFunction, 1, 2);
});

Deno.test("ELU.calculateError: negative region", () => {
  checkDerivativePath(new ELU(), -2, -1.5);
});

Deno.test("ELU.calculateError: fallback at low x", () => {
  // At x=-10, derivative ≈ exp(-10) ≈ 4.5e-5 which is below the
  // vanishing gradient threshold (1e-2). The fallback uses unSquash
  // to compute targetInput - currentInput instead of rawError / slope.
  // This prevents exploding errors. See issue #1588.
  const elu = new ELU();
  const currentValue = -10;
  const targetValue = -9.9;
  const act = elu.squash(currentValue);
  const target = elu.squash(targetValue);

  const error = elu.calculateError(act, target, currentValue);

  assert(Number.isFinite(error), `Error should be finite, got ${error}`);
  // unSquash-based error: targetInput - currentInput ≈ -9.9 - (-10) = 0.1
  assertAlmostEquals(error, targetValue - currentValue, 0.01);
});

Deno.test("ELU.calculateError: perfect match", () => {
  const elu = new ELU();
  const val = elu.squash(0.5);
  const error = elu.calculateError(val, val, 0.5);
  assertAlmostEquals(error, 0, 1e-10);
});
