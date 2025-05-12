import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Mish } from "../../../src/methods/activations/types/Mish.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new Mish();
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

Deno.test("Mish.calculateError: standard case", () => {
  check(0.5, 1.0);
});

Deno.test("Mish.calculateError: exact match", () => {
  const mish = new Mish();
  assertEquals(mish.calculateError(0.8, 0.8, 1.0), 0);
});

Deno.test("Mish.calculateError: negative region", () => {
  const mish = new Mish();
  const e = mish.calculateError(-0.5, 0.5, -3.0);
  assert(Number.isFinite(e));
});
