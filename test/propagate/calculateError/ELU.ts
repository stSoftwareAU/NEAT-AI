import { assert, assertAlmostEquals } from "@std/assert";
import { ELU } from "../../../src/methods/activations/types/ELU.ts";

Deno.test("ELU.calculateError: positive region", () => {
  const elu = new ELU();
  const act = elu.squash(1.0);
  const target = elu.squash(2.0);
  const error = elu.calculateError(act, target, 1.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("ELU.calculateError: negative region", () => {
  const elu = new ELU();
  const act = elu.squash(-2.0);
  const target = elu.squash(-1.5);
  const error = elu.calculateError(act, target, -2.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("ELU.calculateError: fallback at low x", () => {
  const elu = new ELU();
  const act = elu.squash(-10.0);
  const target = elu.squash(-9.9);
  const error = elu.calculateError(act, target, -10.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("ELU.calculateError: perfect match", () => {
  const elu = new ELU();
  const val = elu.squash(0.5);
  const error = elu.calculateError(val, val, 0.5);
  assertAlmostEquals(error, 0, 1e-10);
});
