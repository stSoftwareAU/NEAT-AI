import { assert, assertAlmostEquals } from "@std/assert";
import { SQRT } from "../../../src/methods/activations/types/SQRT.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new SQRT();
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

Deno.test("SQRT near boundary", () => {
  check(-0.5, -1.0);
  check(0.5, 1.0);
  check(-1.1, -1.0);

  check(-0.9, -1.0);
  check(0.9, -1.0);
  check(1.1, 1.0);
  check(0.8, -1.0);
  check(-0.2, 0.3);
});
