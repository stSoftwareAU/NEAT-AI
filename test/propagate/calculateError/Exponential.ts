import { assert, assertAlmostEquals } from "@std/assert";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";

Deno.test("Exponential.calculateError: typical range", () => {
  const exp = new Exponential();
  const act = exp.squash(0.0); // e^0 = 1
  const target = exp.squash(1.0); // e^1 ≈ 2.71
  const error = exp.calculateError(act, target, 0.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("Exponential.calculateError: fallback near 0", () => {
  const exp = new Exponential();
  const act = exp.squash(-10.0); // ≈ 4.5e-5
  const target = exp.squash(-9.5); // slightly larger
  const error = exp.calculateError(act, target, -10.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("Exponential.calculateError: fallback near high x", () => {
  const exp = new Exponential();
  const act = exp.squash(10.0); // large
  const target = exp.squash(10.1); // slightly more
  const error = exp.calculateError(act, target, 10.0);
  assert(Number.isFinite(error));
});

Deno.test("Exponential.calculateError: perfect match", () => {
  const exp = new Exponential();
  const val = exp.squash(1.2);
  const error = exp.calculateError(val, val, 1.2);
  assertAlmostEquals(error, 0, 1e-10);
});
