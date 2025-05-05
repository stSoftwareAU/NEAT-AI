import { assert, assertEquals } from "@std/assert";
import { SELU } from "../../../src/methods/activations/types/SELU.ts";

Deno.test("SELU.calculateError: positive activation", () => {
  const selu = new SELU();
  assertEquals(selu.calculateError(1.0, 1.0, 1.0), 0.0);
  const e = selu.calculateError(0.9, 1.2, 1.0);
  assert(Number.isFinite(e));
  assert(e > 0);
});

Deno.test("SELU.calculateError: negative raw input", () => {
  const selu = new SELU();
  const act = selu.squash(-2.0);
  const e = selu.calculateError(act, 0.1, -2.0);
  assert(Number.isFinite(e));
});

Deno.test("SELU.calculateError: near zero", () => {
  const selu = new SELU();
  const act = selu.squash(0.0);
  const e = selu.calculateError(act, 0.3, 0.0);
  assert(Number.isFinite(e));
});
