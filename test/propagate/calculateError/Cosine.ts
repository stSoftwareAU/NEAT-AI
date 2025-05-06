import { assert, assertAlmostEquals } from "@std/assert";
import { Cosine } from "../../../src/methods/activations/types/Cosine.ts";

Deno.test("Cosine.calculateError: normal slope region", () => {
  const cosine = new Cosine();
  const act = cosine.squash(0.5);
  const target = cosine.squash(1.0);
  const error = cosine.calculateError(act, target, 0.5);
  assert(Number.isFinite(error));
});

Deno.test("Cosine.calculateError: flat zone fallback", () => {
  const cosine = new Cosine();
  const act = cosine.squash(0); // cos(0) = 1
  const target = cosine.squash(0.1);
  const error = cosine.calculateError(act, target, 0);
  assert(Number.isFinite(error));
  assertAlmostEquals(error, 0.1);
});

Deno.test("Cosine.calculateError: negative domain", () => {
  const cosine = new Cosine();
  const act = cosine.squash(-2.0);
  const target = cosine.squash(-1.5);
  const error = cosine.calculateError(act, target, -2.0);
  assert(Number.isFinite(error));
});

Deno.test("Cosine.calculateError: perfect match", () => {
  const cosine = new Cosine();
  const val = cosine.squash(Math.PI);
  const error = cosine.calculateError(val, val, Math.PI);
  assertAlmostEquals(error, 0, 1e-10);
});
