import { assertAlmostEquals } from "@std/assert";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";

Deno.test("ArcTan.calculateError: typical values", () => {
  const arc = new ArcTan();

  const currentValue = 0;
  const targetActivation = 0.5;

  const activation = arc.squash(currentValue);
  const slope = arc.derivative(currentValue);

  const error = arc.calculateError(activation, targetActivation, currentValue);
  const expectedError = (targetActivation - activation) / slope;
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Error: ${error} != ${expectedError}`,
  );
});

Deno.test("ArcTan.calculateError: negative raw", () => {
  const arc = new ArcTan();

  const currentValue = -2;
  const targetActivation = 0;

  const activation = arc.squash(currentValue);
  const slope = arc.derivative(currentValue);

  const error = arc.calculateError(activation, targetActivation, currentValue);
  const expectedError = (targetActivation - activation) / slope;
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Error: ${error} != ${expectedError}`,
  );
});

Deno.test("ArcTan.calculateError: exact match", () => {
  const arc = new ArcTan();

  const val = arc.squash(2.0);
  assertAlmostEquals(arc.calculateError(val, val, 2.0), 0, 1e-10);
});

Deno.test("ArcTan.calculateError: Far in tail (slope small but finite)", () => {
  const arc = new ArcTan();
  const currentValue = 14;
  const targetActivation = 0.5;
  const targetValue = arc.unSquash(targetActivation, currentValue);
  const activation = arc.squash(currentValue);
  const slope = arc.derivative(currentValue);

  const error = arc.calculateError(activation, targetActivation, currentValue);
  const expectedError = Math.max(
    Math.min((targetValue - currentValue) / slope, 100),
    -100,
  );
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Error: ${error} != ${expectedError}`,
  );
});

Deno.test("ArcTan.calculateError: derivative region gives correct direction", () => {
  const arc = new ArcTan();

  const currentValue = 1.0;
  const targetValue = 2.0;

  const act = arc.squash(currentValue); // ≈ π/4 ≈ 0.785
  const target = arc.squash(targetValue); // ≈ 1.107

  const slope = arc.derivative(currentValue); // ≈ 1 / (1 + 1^2) = 0.5
  const expectedError = (target - act) / slope;

  const error = arc.calculateError(act, target, currentValue);

  assertAlmostEquals(error, expectedError, 1e-4);
});

Deno.test("ArcTan.calculateError: fallback region (tail slope too flat)", () => {
  const arc = new ArcTan();

  const currentValue = 20.0;
  const targetValue = 19.5;

  const act = arc.squash(currentValue); // ≈ π/2
  const target = arc.squash(targetValue); // slightly smaller

  const expected = arc.unSquash(target, currentValue) - currentValue;
  const error = arc.calculateError(act, target, currentValue);

  assertAlmostEquals(error, expected, 0.02);
});

Deno.test("ArcTan.calculateError: negative direction derivative", () => {
  const arc = new ArcTan();

  const currentValue = -1.0;
  const targetValue = -2.0;

  const act = arc.squash(currentValue);
  const target = arc.squash(targetValue);

  const slope = arc.derivative(currentValue);
  const expected = (target - act) / slope;

  const error = arc.calculateError(act, target, currentValue);
  assertAlmostEquals(error, expected, 1e-4);
});
