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

  const expected = (act - target) / slope;
  assertAlmostEquals(error, expected, 0.0001);
});
