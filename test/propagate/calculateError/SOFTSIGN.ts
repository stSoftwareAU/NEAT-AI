import { assert, assertAlmostEquals } from "@std/assert";
import { SOFTSIGN } from "../../../src/methods/activations/types/SOFTSIGN.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new SOFTSIGN();
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

Deno.test("SOFTSIGN.calculateError: mid-range", () => {
  check(0.5, 1.0);
});

Deno.test("SOFTSIGN.calculateError: large positive input", () => {
  check(10, 9.5);
});

Deno.test("SOFTSIGN.calculateError: large negative input", () => {
  check(-10, -9.5);
});

Deno.test("SOFTSIGN.calculateError: perfect match", () => {
  const softsign = new SOFTSIGN();
  const val = softsign.squash(-1.2);
  const error = softsign.calculateError(val, val, -1.2);
  assertAlmostEquals(error, 0, 1e-10);
});
