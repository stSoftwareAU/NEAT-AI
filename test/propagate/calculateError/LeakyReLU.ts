import { assert, assertEquals } from "@std/assert";
import { LeakyReLU } from "../../../src/methods/activations/types/LeakyReLU.ts";

Deno.test("LeakyReLU.calculateError: standard positive cases", () => {
  const leaky = new LeakyReLU();
  assertEquals(leaky.calculateError(1.0, 1.0, leaky.unSquash(1)), 0.0); // no error
  assertEquals(leaky.calculateError(0.5, 1.0, leaky.unSquash(0.5)), 0.5); // positive delta
  assertEquals(leaky.calculateError(1.0, 0.0, leaky.unSquash(1)), -1.0); // decreasing
});

Deno.test("LeakyReLU.calculateError: negative case with hint", () => {
  const leaky = new LeakyReLU();
  const alpha = LeakyReLU.ALPHA; // dynamically pull the slope

  // current activation: -1
  // unSquash(-1) = -1 / alpha = -100 (if alpha = 0.01)
  // target = 0, rawError = 1
  // derivative at -100 = alpha → error = 1 * alpha
  const error = leaky.calculateError(-1.0, 0.0, -100);

  assert(Math.abs(error - alpha) < 1e-10, `Error: ${error}`);
  assert(Number.isFinite(error));
});

Deno.test("LeakyReLU.calculateError: corner cases", () => {
  const leaky = new LeakyReLU();

  // both zero
  assertEquals(leaky.calculateError(0.0, 0.0, leaky.unSquash(0)), 0.0);

  // zero target
  assert(Number.isFinite(leaky.calculateError(1.0, 0.0, leaky.unSquash(1))));

  // zero current
  assert(Number.isFinite(leaky.calculateError(0.0, 1.0, leaky.unSquash(0))));

  // large negative input
  assert(Number.isFinite(leaky.calculateError(-1.0, 1.0, -10)));
});
