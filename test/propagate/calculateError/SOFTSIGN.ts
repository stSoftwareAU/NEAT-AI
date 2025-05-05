import { assert, assertAlmostEquals } from "@std/assert";
import { SOFTSIGN } from "../../../src/methods/activations/types/SOFTSIGN.ts";

Deno.test("SOFTSIGN.calculateError: mid-range", () => {
  const softsign = new SOFTSIGN();
  const act = softsign.squash(0.5);
  const target = softsign.squash(1.0);
  const error = softsign.calculateError(act, target, 0.5);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SOFTSIGN.calculateError: large positive input", () => {
  const softsign = new SOFTSIGN();
  const act = softsign.squash(10.0);
  const target = softsign.squash(9.5);
  const error = softsign.calculateError(act, target, 10.0);
  assert(Number.isFinite(error));
  assert(error < 0); // too high
});

Deno.test("SOFTSIGN.calculateError: large negative input", () => {
  const softsign = new SOFTSIGN();
  const act = softsign.squash(-10.0);
  const target = softsign.squash(-9.5);
  const error = softsign.calculateError(act, target, -10.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SOFTSIGN.calculateError: perfect match", () => {
  const softsign = new SOFTSIGN();
  const val = softsign.squash(-1.2);
  const error = softsign.calculateError(val, val, -1.2);
  assertAlmostEquals(error, 0, 1e-10);
});
