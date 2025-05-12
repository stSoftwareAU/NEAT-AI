import { assert, assertAlmostEquals } from "@std/assert";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

function check(
  squashFunction: ActivationInterface,
  currentValue: number,
  targetValue: number,
) {
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

Deno.test("Exponential.calculateError: typical range", () => {
  check(new Exponential(), 0, 1);
});

Deno.test("Exponential.calculateError: fallback near 0", () => {
  check(new Exponential(), -10, -9.5);
});

Deno.test("Exponential.calculateError: fallback near high x", () => {
  const exp = new Exponential();
  const act = exp.squash(10.0); // large
  const target = exp.squash(10.1); // slightly more
  const error = exp.calculateError(act, target, 10.0);
  assert(Number.isFinite(error));
});

Deno.test("Exponential.calculateError: perfect match", () => {
  const exp = new Exponential();
  const val = exp.squash(1.2);
  const error = exp.calculateError(val, val, 1.2);
  assertAlmostEquals(error, 0, 1e-10);
});
