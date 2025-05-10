import { LogSigmoid } from "../../../src/methods/activations/types/LogSigmoid.ts";
import { assert, assertAlmostEquals } from "@std/assert";

Deno.test("LogSigmoid.calculateError: no difference", () => {
  const log = new LogSigmoid();
  const val = log.squash(0.5);
  const error = log.calculateError(val, val, 0.5);
  assertAlmostEquals(error, 0, 1e-10);
});

Deno.test("LogSigmoid.calculateError: derivative works", () => {
  const log = new LogSigmoid();
  const act = log.squash(1.0);
  const target = log.squash(1.5);
  const error = log.calculateError(act, target, 1.0);
  assert(error > 0);
  assert(Number.isFinite(error));
});

Deno.test("LogSigmoid.calculateError: fallback in flat tail", () => {
  const log = new LogSigmoid();
  const act = log.squash(20.0); // flat region
  const target = log.squash(19.0);
  const error = log.calculateError(act, target, 20.0);
  assertAlmostEquals(error, 0);
  assert(Number.isFinite(error));
});
