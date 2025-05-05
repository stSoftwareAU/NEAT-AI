import { assert, assertAlmostEquals } from "@std/assert";
import { SOFTSIGN } from "../../../src/methods/activations/types/SOFTSIGN.ts";

Deno.test("SOFTSIGN.calculateError: mid-range", () => {
  const soft = new SOFTSIGN();

  assertAlmostEquals(soft.calculateError(0.0, 0.5), 0.5, 1e-8);
  const err = soft.calculateError(0.25, 0.5);
  assert(Number.isFinite(err));
  assert(err > 0);
});

Deno.test("SOFTSIGN.calculateError: negative x", () => {
  const soft = new SOFTSIGN();

  const act = soft.squash(-2.0);
  const err = soft.calculateError(act, 0.0, -2.0);
  assert(Number.isFinite(err));
});

Deno.test("SOFTSIGN.calculateError: perfect match", () => {
  const soft = new SOFTSIGN();

  const val = soft.squash(2.5);
  assertAlmostEquals(soft.calculateError(val, val, 2.5), 0, 1e-10);
});
