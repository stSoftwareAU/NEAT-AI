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

Deno.test("ABSOLUTE.calculateError: corner cases", () => {
  const abs = new ABSOLUTE();
  // Current = -2, Target = 1 => nearest |x| = 1 is -1, error = +1
  assertAlmostEquals(
    abs.calculateError(-2, 1, -2),
    1,
  );

  // Current = +2, Target = 1 => nearest |x| = 1 is +1, error = -1
  assertAlmostEquals(
    abs.calculateError(2, 1, 2),
    -1,
  );

  // Current = -0.5, Target = 0.5 => nearest |x| = 0.5 is -0.5, error = 0
  assertAlmostEquals(
    abs.calculateError(-0.5, 0.5, -0.5),
    0,
  );

  // Current = -0.4, Target = 0.5 => nearest is -0.5, error = -0.1
  assertAlmostEquals(
    abs.calculateError(-0.4, 0.5, -0.4),
    -0.1,
  );

  // Current = -0.4, Target = 0 => nearest is 0, error = +0.4
  assertAlmostEquals(
    abs.calculateError(-0.4, 0, -0.4),
    0.4,
  );
});
