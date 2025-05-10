import { BIPOLAR_SIGMOID } from "../../../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("BIPOLAR_SIGMOID.calculateError: match", () => {
  const b = new BIPOLAR_SIGMOID();
  const val = b.squash(0.8);
  const error = b.calculateError(val, val, 0.8);
  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("BIPOLAR_SIGMOID.calculateError: derivative zone", () => {
  const b = new BIPOLAR_SIGMOID();
  const a = b.squash(0.5);
  const t = b.squash(1.0);
  const err = b.calculateError(a, t, 0.5);
  assertAlmostEquals(err, 0.1, 0.1); // expected direction
  assert(Number.isFinite(err));
});

Deno.test("BIPOLAR_SIGMOID.calculateError: fallback", () => {
  const b = new BIPOLAR_SIGMOID();
  const a = b.squash(-10);
  const t = b.squash(10);
  const err = b.calculateError(a, t, -10);
  assert(err > 0);
  assert(Number.isFinite(err));
});
