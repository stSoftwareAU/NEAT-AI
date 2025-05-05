import { assert, assertEquals } from "@std/assert";
import { LOGISTIC } from "../../../src/methods/activations/types/LOGISTIC.ts";

Deno.test("LOGISTIC.calculateError: standard values", () => {
  const sigmoid = new LOGISTIC();

  assertEquals(sigmoid.calculateError(0.5, 0.5), 0.0);

  const e = sigmoid.calculateError(0.5, 0.7);
  assert(e > 0 && Number.isFinite(e));
});

Deno.test("LOGISTIC.calculateError: with hint", () => {
  const sigmoid = new LOGISTIC();

  const e = sigmoid.calculateError(0.3, 0.9, 1.0);
  assert(Number.isFinite(e));
  assert(e > 0);
});

Deno.test("LOGISTIC.calculateError: edge zone", () => {
  const sigmoid = new LOGISTIC();

  const e1 = sigmoid.calculateError(0.001, 0.0, -10);
  const e2 = sigmoid.calculateError(0.999, 1.0, 10);
  assert(Number.isFinite(e1));
  assert(Number.isFinite(e2));
});
