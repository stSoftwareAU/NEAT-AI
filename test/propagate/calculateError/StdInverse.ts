import { StdInverse } from "../../../src/methods/activations/types/StdInverse.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("StdInverse.calculateError: no error", () => {
  const s = new StdInverse();
  const val = s.squash(0.5);
  const error = s.calculateError(val, val, 0.5);
  assertAlmostEquals(error, 0.0, 1e-10);
});

Deno.test("StdInverse.calculateError: positive shift", () => {
  const s = new StdInverse();
  const act = s.squash(0.5);
  const target = s.squash(0.2);
  const error = s.calculateError(act, target, 0.5);
  assert(error < 0);
  assert(Number.isFinite(error));
});

Deno.test("StdInverse.calculateError: negative shift", () => {
  const s = new StdInverse();
  const act = s.squash(-1.0);
  const target = s.squash(-2.0);
  const error = s.calculateError(act, target, -1.0);
  assert(error > 0);
  assert(Number.isFinite(error));
});

Deno.test("StdInverse.calculateError: fallback edge", () => {
  const s = new StdInverse();
  const act = s.squash(50);
  const target = s.squash(40);
  const error = s.calculateError(act, target, 50);
  assert(Number.isFinite(error));
});
