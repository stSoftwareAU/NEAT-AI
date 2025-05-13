import { assert, assertAlmostEquals } from "@std/assert";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";

function check(
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

Deno.test("GELU.calculateError: smooth positive zone", () => {
  const gelu = new GELU();
  check(gelu, 1.0, 1);

  check(gelu, 0.8, 1);
});

Deno.test("GELU.calculateError: near zero", () => {
  const gelu = new GELU();

  const error = gelu.calculateError(0.0, 0.2, -1);
  assert(Number.isFinite(error));
});

Deno.test("GELU.calculateError: upper bound", () => {
  const gelu = new GELU();

  const error = gelu.calculateError(0.5, 0.6, gelu.unSquash(0.5));
  assert(Math.abs(error) > 0);
  assert(Number.isFinite(error));
});
