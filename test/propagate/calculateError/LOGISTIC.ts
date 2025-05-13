import { assert, assertAlmostEquals } from "@std/assert";
import { LOGISTIC } from "../../../src/methods/activations/types/LOGISTIC.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new LOGISTIC();
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

Deno.test("LOGISTIC.calculateError: mid-range", () => {
  check(0, 1.0);
});

Deno.test("LOGISTIC.calculateError: upper flat slope", () => {
  check(10, 8);
});

Deno.test("LOGISTIC.calculateError: lower flat slope", () => {
  check(-10, -8);
});

Deno.test("LOGISTIC.calculateError: perfect match", () => {
  const logistic = new LOGISTIC();
  const val = logistic.squash(-1.23);
  const error = logistic.calculateError(val, val, -1.23);

  assertAlmostEquals(error, 0, 1e-10);
});
