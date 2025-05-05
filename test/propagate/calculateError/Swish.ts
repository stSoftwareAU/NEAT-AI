import { assert, assertEquals } from "@std/assert";
import { Swish } from "../../../src/methods/activations/types/Swish.ts";

Deno.test("Swish.calculateError: basic delta", () => {
  const swish = new Swish();

  const e1 = swish.calculateError(1.0, 1.0, 1.0); // no error
  assertEquals(e1, 0);

  const e2 = swish.calculateError(0.5, 1.0, 0.5);
  assert(e2 > 0 && Number.isFinite(e2));
});

Deno.test("Swish.calculateError: fallback slope if no hint", () => {
  const swish = new Swish();

  const e = swish.calculateError(0.2, 1.0);
  assert(Number.isFinite(e));
});

Deno.test("Swish.calculateError: negative region", () => {
  const swish = new Swish();

  const error = swish.calculateError(-0.2, 0.0, -1.0);
  assert(Number.isFinite(error));
  assert(error > -1 && error < 1);
});
