import { assert, assertAlmostEquals } from "@std/assert";
import { ISRU } from "../../../src/methods/activations/types/ISRU.ts";

Deno.test("ISRU.calculateError: mid-range", () => {
  const isru = new ISRU();
  const act = isru.squash(1.0);
  const target = isru.squash(2.0);
  const error = isru.calculateError(act, target, 1.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("ISRU.calculateError: near zero", () => {
  const isru = new ISRU();
  const act = isru.squash(0.0);
  const target = isru.squash(0.001);
  const error = isru.calculateError(act, target, 0.0);
  assertAlmostEquals(error, 0.001, 1e-4);
});

Deno.test("ISRU.calculateError: fallback in tails", () => {
  const isru = new ISRU();
  const act = isru.squash(10.0);
  const target = isru.squash(9.5);
  const error = isru.calculateError(act, target, 10.0);
  assert(Number.isFinite(error));
  assertAlmostEquals(error, -0.5, 1e-1);
});

Deno.test("ISRU.calculateError: perfect match", () => {
  const isru = new ISRU();
  const val = isru.squash(2.0);
  const error = isru.calculateError(val, val, 2.0);
  assertAlmostEquals(error, 0, 1e-10);
});
