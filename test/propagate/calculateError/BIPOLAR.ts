import { BIPOLAR } from "../../../src/methods/activations/types/BIPOLAR.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("BIPOLAR.calculateError: perfect match", () => {
  const b = new BIPOLAR();
  const val = b.squash(0.7);
  const error = b.calculateError(val, val, 0.7);
  assertAlmostEquals(error, 0);
});

Deno.test("BIPOLAR.calculateError: mismatch positive to negative", () => {
  const b = new BIPOLAR();
  const act = b.squash(1.0); // 1
  const target = b.squash(-1); // -1
  const error = b.calculateError(act, target, 1.0);
  assert(error < 0);
  assert(Number.isFinite(error));
});

Deno.test("BIPOLAR.calculateError: mismatch negative to positive", () => {
  const b = new BIPOLAR();
  const act = b.squash(-0.5); // -1
  const target = b.squash(0.5); // +1
  const error = b.calculateError(act, target, -0.5);
  assert(error > 0);
  assert(Number.isFinite(error));
});
