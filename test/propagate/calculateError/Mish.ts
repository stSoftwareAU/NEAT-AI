import { assert, assertEquals } from "@std/assert";
import { Mish } from "../../../src/methods/activations/types/Mish.ts";

Deno.test("Mish.calculateError: standard case", () => {
  const mish = new Mish();

  const error = mish.calculateError(0.5, 1.0, 1.0); // x = 1.0
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("Mish.calculateError: exact match", () => {
  const mish = new Mish();
  assertEquals(mish.calculateError(0.8, 0.8, 1.0), 0);
});

Deno.test("Mish.calculateError: negative region", () => {
  const mish = new Mish();
  const e = mish.calculateError(-0.5, 0.5, -3.0);
  assert(Number.isFinite(e));
});
