import { assertAlmostEquals } from "@std/assert";
import { BIPOLAR_SIGMOID } from "../../../src/methods/activations/types/BIPOLAR_SIGMOID.ts";

Deno.test("BIPOLAR_SIGMOID.calculateError: match", () => {
  const b = new BIPOLAR_SIGMOID();
  const val = b.squash(0.8);
  const error = b.calculateError(val, val, 0.8);
  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("BIPOLAR_SIGMOID.calculateError: mid-range", () => {
  const b = new BIPOLAR_SIGMOID();
  const x = 0.8;
  const act = b.squash(x);
  const slope = 0.5 * (1 - act ** 2);
  const target = 0.5;
  const error = b.calculateError(act, target, x);

  const expected = (target - act) / slope;
  assertAlmostEquals(error, expected, 0.0001);
});

Deno.test("BIPOLAR_SIGMOID.calculateError: derivative - positive direction", () => {
  const b = new BIPOLAR_SIGMOID();

  const currentValue = 0;
  const targetValue = 1.0;

  const act = b.squash(currentValue);   // ≈ 0
  const target = b.squash(targetValue); // ≈ 0.761

  const slope = b.derivative(currentValue); // = (1 - 0²) / 2 = 0.5
  const expected = (target - act) / slope;

  const error = b.calculateError(act, target, currentValue);

  assertAlmostEquals(error, expected, 1e-4);
});

Deno.test("BIPOLAR_SIGMOID.calculateError: derivative - negative direction", () => {
  const b = new BIPOLAR_SIGMOID();

  const currentValue = 0;
  const targetValue = -1.0;

  const act = b.squash(currentValue);   // ≈ 0
  const target = b.squash(targetValue); // ≈ -0.761

  const slope = b.derivative(currentValue); // still ≈ 0.5
  const expected = (target - act) / slope;

  const error = b.calculateError(act, target, currentValue);

  assertAlmostEquals(error, expected, 1e-4);
});
