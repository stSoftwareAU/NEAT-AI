import { assert, assertAlmostEquals } from "@std/assert";
import { SINE } from "../../../src/methods/activations/types/SINE.ts";

Deno.test("SINE.calculateError: smooth slope", () => {
  const sine = new SINE();
  const act = sine.squash(0.5);
  const target = sine.squash(1.0);
  const error = sine.calculateError(act, target, 0.5);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SINE.calculateError: zero slope fallback", () => {
  const sine = new SINE();
  const act = sine.squash(Math.PI / 2); // slope ≈ 0
  const target = sine.squash(Math.PI / 2 - 0.1);
  const error = sine.calculateError(act, target, Math.PI / 2);
  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("SINE.calculateError: negative domain", () => {
  const sine = new SINE();
  const act = sine.squash(-2.0);
  const target = sine.squash(-1.8);
  const error = sine.calculateError(act, target, -2.0);
  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("SINE.calculateError: perfect match", () => {
  const sine = new SINE();
  const val = sine.squash(1.2);
  const error = sine.calculateError(val, val, 1.2);
  assertAlmostEquals(error, 0, 1e-10);
});
