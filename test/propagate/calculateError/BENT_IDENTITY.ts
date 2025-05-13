import { assert, assertAlmostEquals } from "@std/assert";
import { BENT_IDENTITY } from "../../../src/methods/activations/types/BENT_IDENTITY.ts";

Deno.test("BentIdentity.calculateError: mid-range input", () => {
  const bent = new BENT_IDENTITY();
  const x = 1.5;
  const activation = bent.squash(x);
  const slope = bent.derivative(x);
  const targetActivation = 1.0;
  const error = bent.calculateError(activation, targetActivation, x);

  const expected = (targetActivation - activation) / slope;
  assertAlmostEquals(error, expected, 0.0001);
});

Deno.test("BENT_IDENTITY.calculateError: negative values", () => {
  const squasher = new BENT_IDENTITY();
  const currentValue = -2;
  const targetActivation = -1.5;

  const activation = squasher.squash(currentValue);
  const slope = squasher.derivative(currentValue);

  const error = squasher.calculateError(
    activation,
    targetActivation,
    currentValue,
  );
  const expectedError = (targetActivation - activation) / slope;
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Error: ${error} != ${expectedError}`,
  );
});

Deno.test("BENT_IDENTITY.calculateError: flat slope edge (large x)", () => {
  const bent = new BENT_IDENTITY();
  const act = bent.squash(10.0);
  const target = bent.squash(9.5);
  const error = bent.calculateError(act, target, 10.0);

  const slope = bent.derivative(10.0);
  const expectedError = (target - act) / slope;

  assert(Number.isFinite(error));
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Error: ${error} != ${expectedError}`,
  );
});

Deno.test("BENT_IDENTITY.calculateError: perfect match", () => {
  const bent = new BENT_IDENTITY();
  const val = bent.squash(2.0);
  const error = bent.calculateError(val, val, 2.0);
  assertAlmostEquals(error, 0, 1e-10);
});
