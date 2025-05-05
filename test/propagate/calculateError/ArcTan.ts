import { assert, assertAlmostEquals } from "@std/assert";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";

Deno.test("ArcTan.calculateError: typical values", () => {
  const arc = new ArcTan();
  const hint = 0.0;
  const slope = arc.derivative(hint); // = 1
  const expectedError = (0.5 - 0.0) * slope;

  const actual = arc.calculateError(0.0, 0.5, hint);
  assertAlmostEquals(actual, expectedError, 1e-8);
});

Deno.test("ArcTan.calculateError: negative raw", () => {
  const arc = new ArcTan();

  const act = arc.squash(-2.0);
  const err = arc.calculateError(act, 0.0, -2.0);
  assert(Number.isFinite(err));
  assert(err > 0);
});

Deno.test("ArcTan.calculateError: exact match", () => {
  const arc = new ArcTan();

  const val = arc.squash(2.0);
  assertAlmostEquals(arc.calculateError(val, val, 2.0), 0, 1e-10);
});
