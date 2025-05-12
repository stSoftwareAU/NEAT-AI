import { assert, assertAlmostEquals } from "@std/assert";
import { Softplus } from "../../../src/methods/activations/types/Softplus.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new Softplus();
  const act = squashFunction.squash(currentValue);
  const target = squashFunction.squash(targetValue);

  const slope = squashFunction.derivative!(currentValue);
  const expectedError = (act - target) / slope;

  const error = squashFunction.calculateError!(act, target, currentValue);

  assert(Number.isFinite(error));
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Expected ${expectedError}, got ${error}`,
  );
}

Deno.test("Softplus.calculateError: mid-range", () => {
  check(1, 1);
  check(1, 1.5);
});

Deno.test("Softplus.calculateError: hint-based slope", () => {
  check(1e-15, 0.8);
});

Deno.test("Softplus.calculateError: near flat zone", () => {
  const softplus = new Softplus();

  const e = softplus.calculateError(0.01, 0.5, -5);
  assert(Number.isFinite(e));
});
