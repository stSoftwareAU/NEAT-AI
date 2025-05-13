import { assert, assertAlmostEquals } from "@std/assert";
import { ISRU } from "../../../src/methods/activations/types/ISRU.ts";
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

Deno.test("ISRU.calculateError: mid-range", () => {
  const isru = new ISRU();
  check(isru, 1.0, 2.0);
});

Deno.test("ISRU.calculateError: near zero", () => {
  const isru = new ISRU();
  check(isru, 0, 0.001);
});

Deno.test("ISRU.calculateError: fallback in tails", () => {
  const isru = new ISRU();
  check(isru, 10, 9.5);
});

Deno.test("ISRU.calculateError: perfect match", () => {
  const isru = new ISRU();
  const val = isru.squash(2.0);
  const error = isru.calculateError(val, val, 2.0);
  assertAlmostEquals(error, 0, 1e-10);
});
