import { assert, assertAlmostEquals } from "@std/assert";
import { ELU } from "../../../src/methods/activations/types/ELU.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

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

Deno.test("ELU.calculateError: positive region", () => {
  const squashFunction = new ELU();

  check(squashFunction, 1, 2);
});

Deno.test("ELU.calculateError: negative region", () => {
  check(new ELU(), -2, -1.5);
});

Deno.test("ELU.calculateError: fallback at low x", () => {
  check(new ELU(), -10, -9.9);
});

Deno.test("ELU.calculateError: perfect match", () => {
  const elu = new ELU();
  const val = elu.squash(0.5);
  const error = elu.calculateError(val, val, 0.5);
  assertAlmostEquals(error, 0, 1e-10);
});
