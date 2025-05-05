import { assert, assertAlmostEquals } from "@std/assert";
import { SELU } from "../../../src/methods/activations/types/SELU.ts";

Deno.test("SELU.calculateError: positive region", () => {
  const selu = new SELU();
  const act = selu.squash(1.0);
  const target = selu.squash(2.0);
  const error = selu.calculateError(act, target, 1.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SELU.calculateError: negative region", () => {
  const selu = new SELU();
  const act = selu.squash(-1.0);
  const target = selu.squash(-0.5);
  const error = selu.calculateError(act, target, -1.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SELU.calculateError: fallback at low x", () => {
  const selu = new SELU();
  const act = selu.squash(-10.0);
  const target = selu.squash(-9.9);
  const error = selu.calculateError(act, target, -10.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SELU.calculateError: perfect match", () => {
  const selu = new SELU();
  const val = selu.squash(-0.5);
  const error = selu.calculateError(val, val, -0.5);
  assertAlmostEquals(error, 0, 1e-10);
});
