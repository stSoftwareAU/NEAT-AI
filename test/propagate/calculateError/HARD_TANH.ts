import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { HARD_TANH } from "../../../src/methods/activations/types/HARD_TANH.ts";

function check(
  currentValue: number,
  targetValue: number,
  errorOverride?: number,
) {
  const squashFunction = new HARD_TANH();
  const act = squashFunction.squash(currentValue);
  const target = squashFunction.squash(targetValue);

  const expectedError = errorOverride === undefined
    ? targetValue - currentValue
    : errorOverride;

  const error = squashFunction.calculateError!(act, target, currentValue);

  assert(Number.isFinite(error));
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Expected ${expectedError}, got ${error}`,
  );
}

Deno.test("HARD_TANH.calculateError: linear region", () => {
  const ht = new HARD_TANH();

  assertAlmostEquals(ht.calculateError(0.0, 0.5, ht.unSquash(0)), 0.5);
  assertAlmostEquals(ht.calculateError(-0.2, -0.8, ht.unSquash(-0.2)), -0.6);
});

Deno.test("HARD_TANH.calculateError: flat region fallback", () => {
  const ht = new HARD_TANH();

  const error = ht.calculateError(1.0, 0.5, 2.0); // in saturated region
  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("HARD_TANH.calculateError: exact match", () => {
  const ht = new HARD_TANH();

  assertEquals(ht.calculateError(1.0, 1.0, 10), 0);
  assertEquals(ht.calculateError(-1.0, -1.0, -10), 0);
});

Deno.test("HARD_TANH.calculateError: flat region correctly uses unSquash fallback", () => {
  const ht = new HARD_TANH();

  const currentValue = 5; // well into the flat upper region
  const currentActivation = ht.squash(currentValue); // = 1
  const targetActivation = 0;

  const error = ht.calculateError(
    currentActivation,
    targetActivation,
    currentValue,
  );

  // Expect error to push currentValue down (toward threshold)
  assert(error < 0, `Expected negative error to reduce x, got ${error}`);

  // Don't expect it to be clamped unless it's > 100 — so just check it's plausible
  assertAlmostEquals(error, -5);
});

Deno.test("HARD_TANH near boundary", () => {
  check(0.5, 1.0);
  check(-0.5, -1.0);
  check(-1.1, -1.0, 0);

  check(-0.9, -1.0);
  check(0.9, -1.0);
  check(1.1, 1.0, 0);
  check(0.8, -1.0);
  check(-0.2, 0.3);
});
