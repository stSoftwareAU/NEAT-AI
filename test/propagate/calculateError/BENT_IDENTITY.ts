import { assert, assertAlmostEquals } from "@std/assert";
import { BENT_IDENTITY } from "../../../src/methods/activations/types/BENT_IDENTITY.ts";

Deno.test("BENT_IDENTITY.calculateError: linear-ish region", () => {
  const bent = new BENT_IDENTITY();

  assertAlmostEquals(bent.calculateError(0.0, 0.5), 0.5, 1e-8);
  const err = bent.calculateError(0.3, 0.9);
  assert(Number.isFinite(err));
  assert(err > 0);
});

Deno.test("BENT_IDENTITY.calculateError: negative raw", () => {
  const bent = new BENT_IDENTITY();

  const act = bent.squash(-2.0);
  const e = bent.calculateError(act, 0.0, -2.0);
  assert(Number.isFinite(e));
  assert(e > 0);
});

Deno.test("BENT_IDENTITY.calculateError: match", () => {
  const bent = new BENT_IDENTITY();
  const val = bent.squash(1.23);

  assertAlmostEquals(bent.calculateError(val, val, 1.23), 0, 1e-10);
});
