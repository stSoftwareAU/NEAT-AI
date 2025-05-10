import { assert, assertEquals } from "@std/assert";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";

Deno.test("GELU.calculateError: smooth positive zone", () => {
  const gelu = new GELU();

  const error1 = gelu.calculateError(1.0, 1.0, gelu.unSquash(1));
  assertEquals(error1, 0.0);

  const error2 = gelu.calculateError(0.8, 1.0, gelu.unSquash(0.8));
  assert(error2 > 0 && Number.isFinite(error2));
});

Deno.test("GELU.calculateError: near zero", () => {
  const gelu = new GELU();

  const error = gelu.calculateError(0.0, 0.2, -1);
  assert(Number.isFinite(error));
});

Deno.test("GELU.calculateError: upper bound", () => {
  const gelu = new GELU();

  const error = gelu.calculateError(0.5, 0.6, gelu.unSquash(0.5));
  assert(Math.abs(error) > 0);
  assert(Number.isFinite(error));
});
