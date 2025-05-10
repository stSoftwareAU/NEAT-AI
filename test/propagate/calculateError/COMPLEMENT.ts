import { COMPLEMENT } from "../../../src/methods/activations/types/COMPLEMENT.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("COMPLEMENT.calculateError: identity case", () => {
  const c = new COMPLEMENT();
  const error = c.calculateError(0.5, 0.5, 0.5);
  assertAlmostEquals(error, 0.0);
});

Deno.test("COMPLEMENT.calculateError: increasing activation", () => {
  const c = new COMPLEMENT();
  const error = c.calculateError(0.3, 0.5, 0.3);
  assertAlmostEquals(error, -0.2); // -1 * 0.2
});

Deno.test("COMPLEMENT.calculateError: decreasing activation", () => {
  const c = new COMPLEMENT();
  const error = c.calculateError(0.8, 0.2, 0.8);
  assertAlmostEquals(error, 0.6); // -1 * -0.6
});

Deno.test("COMPLEMENT.calculateError: finiteness", () => {
  const c = new COMPLEMENT();
  const error = c.calculateError(1.0, 0.0, 1);
  assert(Number.isFinite(error));
});
