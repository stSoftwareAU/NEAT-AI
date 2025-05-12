import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { assertAlmostEquals } from "@std/assert";

Deno.test("IDENTITY.calculateError: zero error", () => {
  const id = new IDENTITY();
  assertAlmostEquals(id.calculateError(0.5, 0.5, id.unSquash(0.5)), 0);
});

Deno.test("IDENTITY.calculateError: positive error", () => {
  const id = new IDENTITY();
  assertAlmostEquals(id.calculateError(0.2, 0.5, id.unSquash(0.2)), 0.3);
});

Deno.test("IDENTITY.calculateError: negative error", () => {
  const id = new IDENTITY();
  assertAlmostEquals(id.calculateError(1.0, 0.5, id.unSquash(1)), -0.5);
});

Deno.test("IDENTITY.calculateError: always finite", () => {
  const id = new IDENTITY();
  const err = id.calculateError(
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  assertAlmostEquals(err, -100);
});
