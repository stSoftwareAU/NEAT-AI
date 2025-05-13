import { assert, assertAlmostEquals } from "@std/assert";
import { SINE } from "../../../src/methods/activations/types/SINE.ts";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new SINE();
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

Deno.test("SINE.calculateError: smooth slope", () => {
  check(0.5, 1.0);
});

Deno.test("SINE.calculateError: zero slope fallback", () => {
  const sine = new SINE();
  const act = sine.squash(Math.PI / 2); // slope ≈ 0
  const target = sine.squash(Math.PI / 2 - 0.1);
  const error = sine.calculateError(act, target, Math.PI / 2);
  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("SINE.calculateError: negative domain", () => {
  check(-2, -1.8);
});

Deno.test("SINE.calculateError: perfect match", () => {
  const sine = new SINE();
  const val = sine.squash(1.2);
  const error = sine.calculateError(val, val, 1.2);
  assertAlmostEquals(error, 0, 1e-10);
});
