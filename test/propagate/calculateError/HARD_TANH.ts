import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { HARD_TANH } from "../../../src/methods/activations/types/HARD_TANH.ts";

Deno.test("HARD_TANH.calculateError: linear region", () => {
  const ht = new HARD_TANH();

  assertAlmostEquals(ht.calculateError(0.0, 0.5), 0.5);
  assertAlmostEquals(ht.calculateError(-0.2, -0.8), -0.6);
});

Deno.test("HARD_TANH.calculateError: flat region fallback", () => {
  const ht = new HARD_TANH();

  const error = ht.calculateError(1.0, 0.5, 2.0); // in saturated region
  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("HARD_TANH.calculateError: exact match", () => {
  const ht = new HARD_TANH();

  assertEquals(ht.calculateError(1.0, 1.0, 10), 0);
  assertEquals(ht.calculateError(-1.0, -1.0, -10), 0);
});
