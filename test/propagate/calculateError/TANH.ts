import { assert, assertAlmostEquals } from "@std/assert";
import { TANH } from "../../../src/methods/activations/types/TANH.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new TANH();
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
Deno.test("TANH.calculateError: mid-range", () => {
  check(0.5, 1.0);
});

Deno.test("TANH.calculateError: near +1 (flat slope)", () => {
  const tanh = new TANH();
  const act = tanh.squash(5); // ≈ 0.9999
  const target = tanh.squash(5.1); // very small delta

  const error = tanh.calculateError(act, target, 5);
  assert(Number.isFinite(error));
});

Deno.test("TANH.calculateError: near -1 (flat slope)", () => {
  const tanh = new TANH();
  const act = tanh.squash(-5);
  const target = tanh.squash(-4.9);

  const error = tanh.calculateError(act, target, -5);
  assert(Number.isFinite(error));
});

Deno.test("TANH.calculateError: perfect match", () => {
  const tanh = new TANH();
  const val = tanh.squash(2);
  const error = tanh.calculateError(val, val, 2);

  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("TANH.calculateError: fallback activation edge", () => {
  const tanh = new TANH();

  const act = tanh.squash(10); // Should be ≈ 1.0
  const target = tanh.squash(8);
  const error = tanh.calculateError(act, target, 10);

  assert(Number.isFinite(error));
  assertAlmostEquals(error, 0);
});
