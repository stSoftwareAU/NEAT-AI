import { assert, assertEquals } from "@std/assert";
import { ELU } from "../../../src/methods/activations/types/ELU.ts";

Deno.test("ELU.calculateError: positive input", () => {
  const elu = new ELU();

  assertEquals(elu.calculateError(1.0, 1.0, 1.0), 0);
  const e = elu.calculateError(0.8, 1.2, 1.0);
  assert(Number.isFinite(e));
  assert(e > 0);
});

Deno.test("ELU.calculateError: negative input", () => {
  const elu = new ELU();

  const act = elu.squash(-1.0);
  const e = elu.calculateError(act, 0.5, -1.0);
  assert(Number.isFinite(e));
  assert(e > 0);
});

Deno.test("ELU.calculateError: zero input", () => {
  const elu = new ELU();

  const act = elu.squash(0.0);
  const e = elu.calculateError(act, 0.2, 0.0);
  assert(Number.isFinite(e));
});
