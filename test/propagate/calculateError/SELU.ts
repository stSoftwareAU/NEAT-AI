import { assert, assertAlmostEquals } from "@std/assert";
import { SELU } from "../../../src/methods/activations/types/SELU.ts";

function check(
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
  check(1.0, 2);
});

Deno.test("SELU.calculateError: negative region", () => {
  check(-1.0, -0.5);
});

Deno.test("SELU.calculateError: fallback at low x", () => {
  check(-10.0, -9.9);
});

Deno.test("SELU.calculateError: perfect match", () => {
  const selu = new SELU();
  const val = selu.squash(-0.5);
  const error = selu.calculateError(val, val, -0.5);
  assertAlmostEquals(error, 0, 1e-10);
});
