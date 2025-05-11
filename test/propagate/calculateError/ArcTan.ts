import { assertAlmostEquals } from "@std/assert";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";

Deno.test("ArcTan.calculateError: typical values", () => {
  const arc = new ArcTan();

  const currentValue = 0;
  const targetActivation = 0.5;

  const activation = arc.squash(currentValue);
  const slope = arc.derivative(currentValue);

  const error = arc.calculateError(activation, targetActivation, currentValue);
  const expectedError = (activation - targetActivation) / slope;
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
  const expectedError = (activation - targetActivation) / slope;
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

  const activation = arc.squash(currentValue);
  const slope = arc.derivative(currentValue);

  const error = arc.calculateError(activation, targetActivation, currentValue);
  const expectedError = (activation - targetActivation) / slope;
  assertAlmostEquals(
    error,
    expectedError,
    0.0001,
    `Error: ${error} != ${expectedError}`,
  );
});
