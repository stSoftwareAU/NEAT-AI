import { assert, assertAlmostEquals } from "@std/assert";
import { LOGISTIC } from "../../../src/methods/activations/types/LOGISTIC.ts";

Deno.test("LOGISTIC.calculateError: mid-range", () => {
  const logistic = new LOGISTIC();
  const act = logistic.squash(0.0);
  const target = logistic.squash(1.0);
  const error = logistic.calculateError(act, target, 0.0);

  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("LOGISTIC.calculateError: upper flat slope", () => {
  const logistic = new LOGISTIC();
  const act = logistic.squash(10);
  const target = logistic.squash(8);
  const error = logistic.calculateError(act, target, 10);

  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("LOGISTIC.calculateError: lower flat slope", () => {
  const logistic = new LOGISTIC();
  const act = logistic.squash(-10);
  const target = logistic.squash(-8);
  const error = logistic.calculateError(act, target, -10);

  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("LOGISTIC.calculateError: perfect match", () => {
  const logistic = new LOGISTIC();
  const val = logistic.squash(-1.23);
  const error = logistic.calculateError(val, val, -1.23);

  assertAlmostEquals(error, 0, 1e-10);
});
