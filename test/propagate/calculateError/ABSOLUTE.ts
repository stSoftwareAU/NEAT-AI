import { assert, assertAlmostEquals } from "@std/assert";
import { ABSOLUTE } from "../../../src/methods/activations/types/ABSOLUTE.ts";

Deno.test("ABSOLUTE.calculateError: positive delta", () => {
  const abs = new ABSOLUTE();
  const rawValue = -1;

  const act = abs.squash(rawValue);
  const target = abs.squash(-2.0); // Still 2.0, just larger
  const error = abs.calculateError(act, target, rawValue);
  assert(Number.isFinite(error));
  assertAlmostEquals(error, -1);
});

Deno.test("ABSOLUTE.calculateError: negative delta", () => {
  const abs = new ABSOLUTE();
  const act = abs.squash(2.0);
  const target = abs.squash(1.0);
  const error = abs.calculateError(act, target, 2.0);
  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("ABSOLUTE.calculateError: zero input", () => {
  const abs = new ABSOLUTE();
  const rawValue = -10;
  const act = abs.squash(rawValue);
  const target = abs.squash(1.0);
  const error = abs.calculateError(act, target, rawValue);
  assert(Number.isFinite(error));
  assertAlmostEquals(error, 9);
});

Deno.test("ABSOLUTE.calculateError: perfect match", () => {
  const abs = new ABSOLUTE();
  const val = abs.squash(-1.5);
  const error = abs.calculateError(val, val, -1.5);
  assertAlmostEquals(error, 0, 1e-10);
});
