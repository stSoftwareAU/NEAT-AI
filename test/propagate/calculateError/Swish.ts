import { assert, assertAlmostEquals } from "@std/assert";
import { Swish } from "../../../src/methods/activations/types/Swish.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new Swish();
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

Deno.test("Swish.calculateError: basic delta", () => {
  check(1, 1);
});

Deno.test("Swish.calculateError: negative region", () => {
  check(-0.2, 0);
});
