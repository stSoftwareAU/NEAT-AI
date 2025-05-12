import { assert, assertAlmostEquals } from "@std/assert";
import { Cube } from "../../../src/methods/activations/types/Cube.ts";

Deno.test("Cube.calculateError: normal region", () => {
  const cube = new Cube();
  const currentValue = 1.0;
  const act = cube.squash(currentValue);
  const target = cube.squash(2.0);

  const slope = cube.derivative(currentValue);
  const expectedError = (act - target) / slope;

  const error = cube.calculateError(act, target, currentValue);

  assert(Number.isFinite(error));
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Expected ${expectedError}, got ${error}`,
  );
});

Deno.test("Cube.calculateError: small x (slope ≈ 0)", () => {
  const cube = new Cube();
  const act = cube.squash(0.001);
  const target = cube.squash(0.002);
  const error = cube.calculateError(act, target, 0.001);
  assert(Number.isFinite(error));
});

Deno.test("Cube.calculateError: negative region", () => {
  const cube = new Cube();
  const currentValue = -2.0;
  const act = cube.squash(currentValue);
  const target = cube.squash(-1.0);

  const slope = cube.derivative(currentValue);
  const expectedError = (act - target) / slope;

  const error = cube.calculateError(act, target, currentValue);

  assert(Number.isFinite(error));
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Expected ${expectedError}, got ${error}`,
  );
});

Deno.test("Cube.calculateError: perfect match", () => {
  const cube = new Cube();
  const val = cube.squash(1.5);
  const error = cube.calculateError(val, val, 1.5);
  assertAlmostEquals(error, 0, 1e-10);
});
