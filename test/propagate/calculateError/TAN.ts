import { TAN } from "../../../src/methods/activations/types/TAN.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("TAN.calculateError: small x (safe slope)", () => {
  const t = new TAN();
  const act = t.squash(0.5); // tan(0.5)
  const target = t.squash(0.6); // slightly higher
  const error = t.calculateError(act, target, 0.5);
  assert(error > 0);
  assert(Number.isFinite(error));
});

Deno.test("TAN.calculateError: zero error", () => {
  const t = new TAN();
  const val = t.squash(1.0);
  const error = t.calculateError(val, val, 1.0);
  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("TAN.calculateError: near π/2 fallback", () => {
  const t = new TAN();
  const act = t.squash(1.55); // very steep
  const target = t.squash(1.52);
  const error = t.calculateError(act, target, 1.55);
  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("TAN.calculateError: negative slope zone", () => {
  const t = new TAN();
  const act = t.squash(-1.0);
  const target = t.squash(-1.3);
  const error = t.calculateError(act, target, -1.0);
  assert(error < 0);
  assert(Number.isFinite(error));
});
