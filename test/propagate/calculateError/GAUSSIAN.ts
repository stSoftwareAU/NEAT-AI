import { assert, assertAlmostEquals } from "@std/assert";
import { GAUSSIAN } from "../../../src/methods/activations/types/GAUSSIAN.ts";

Deno.test("GAUSSIAN.calculateError: peak region (fallback)", () => {
  const g = new GAUSSIAN();
  const act = g.squash(0.0); // f(0) = 1
  const target = g.squash(0.5); // ≈ 0.7788
  const error = g.calculateError(act, target, 0.0);
  assert(Number.isFinite(error));
  assertAlmostEquals(Math.abs(error), 0.45, 0.1); // fallback Δ = 0.5
});

Deno.test("GAUSSIAN.calculateError: shoulder region", () => {
  const g = new GAUSSIAN();
  const act = g.squash(1.0); // ≈ 0.3679
  const target = g.squash(1.5); // ≈ 0.1054
  const error = g.calculateError(act, target, 1.0);
  assertAlmostEquals(error, 0.193, 1e-3); // correct path, correct slope
});

Deno.test("GAUSSIAN.calculateError: tail region (fallback)", () => {
  const g = new GAUSSIAN();
  const act = g.squash(4.0); // ≈ 3.3e-7
  const target = g.squash(3.8); // ≈ 1.8e-6
  const error = g.calculateError(act, target, 4.0);
  assertAlmostEquals(error, 0, 1e-2);
});

Deno.test("GAUSSIAN.calculateError: perfect match", () => {
  const g = new GAUSSIAN();
  const val = g.squash(2.0);
  const error = g.calculateError(val, val, 2.0);
  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("GAUSSIAN.calculateError: fallback negative direction", () => {
  const g = new GAUSSIAN();
  const act = g.squash(-4.0);
  const target = g.squash(-3.8);
  const error = g.calculateError(act, target, -4.0);
  assertAlmostEquals(error, 0, 1e-1);
});

Deno.test("GAUSSIAN.calculateError: symmetric", () => {
  const g = new GAUSSIAN();
  const act = g.squash(-1.0);
  const target = g.squash(1.0);
  const error = g.calculateError(act, target, -1);
  assertAlmostEquals(error, 0);
});
