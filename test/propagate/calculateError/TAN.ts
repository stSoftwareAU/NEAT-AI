import { TAN } from "../../../src/methods/activations/types/TAN.ts";
import { assert, assertAlmostEquals } from "@std/assert";

function check(
  currentValue: number,
  targetValue: number,
) {
  const squashFunction = new TAN();
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

Deno.test("TAN.calculateError: small x (safe slope)", () => {
  check(0.5, 0.6);
});

Deno.test("TAN.calculateError: zero error", () => {
  const t = new TAN();
  const val = t.squash(1.0);
  const error = t.calculateError(val, val, 1.0);
  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("TAN.calculateError: near π/2 fallback", () => {
  check(1.55, 1.52);
});

Deno.test("TAN.calculateError: negative slope zone", () => {
  check(-1, -1.3);
});
