import { assert, assertEquals } from "@std/assert";
import { TANH } from "../../../src/methods/activations/types/TANH.ts";

Deno.test("TANH.calculateError: middle range", () => {
  const tanh = new TANH();

  assertEquals(tanh.calculateError(0.0, 0.0), 0.0);
  assert(tanh.calculateError(0.3, 0.6) > 0);
  assert(tanh.calculateError(-0.6, -0.2) > 0);
});

Deno.test("TANH.calculateError: with hint", () => {
  const tanh = new TANH();

  const e = tanh.calculateError(0.0, 0.8, 1.0);
  assert(Number.isFinite(e));
  assert(e > 0);
});

Deno.test("TANH.calculateError: near saturation", () => {
  const tanh = new TANH();

  const e = tanh.calculateError(0.999, 1.0, 5.0); // close to flat zone
  assert(Number.isFinite(e));
  assert(e >= 0);
});
