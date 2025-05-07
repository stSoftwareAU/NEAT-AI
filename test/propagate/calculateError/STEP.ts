import { STEP } from "../../../src/methods/activations/types/STEP.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("STEP.calculateError: no error (same output)", () => {
  const step = new STEP();
  const act = step.squash(1.0);
  const error = step.calculateError(act, act, 1.0);
  assertAlmostEquals(error, 0.0, 1e-10);
});

Deno.test("STEP.calculateError: target is 1, current is 0", () => {
  const step = new STEP();
  const act = step.squash(-1.0); // 0
  const target = step.squash(1.0); // 1
  const error = step.calculateError(act, target, -1.0);
  assert(error > 0);
  assert(Number.isFinite(error));
});

Deno.test("STEP.calculateError: target is 0, current is 1", () => {
  const step = new STEP();
  const act = step.squash(1.0); // 1
  const target = step.squash(-1.0); // 0
  const error = step.calculateError(act, target, 1.0);
  assert(error < 0);
  assert(Number.isFinite(error));
});
