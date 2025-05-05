import { assert, assertEquals } from "@std/assert";
import { Softplus } from "../../../src/methods/activations/types/Softplus.ts";

Deno.test("Softplus.calculateError: mid-range", () => {
  const softplus = new Softplus();

  assertEquals(softplus.calculateError(1.0, 1.0), 0.0);

  const e = softplus.calculateError(1.0, 1.5);
  assert(e > 0 && Number.isFinite(e));
});

Deno.test("Softplus.calculateError: hint-based slope", () => {
  const softplus = new Softplus();

  const min = 1e-15;
  const e = softplus.calculateError(min, 0.8, 1.0); // near valid edge

  assert(Number.isFinite(e), `Error should be finite: ${e}`);
  assert(e >= 0, `Error should not be negative: ${e}`);
  assert(e > 1e-6, `Error unexpectedly small: ${e}`);
});

Deno.test("Softplus.calculateError: near flat zone", () => {
  const softplus = new Softplus();

  const e = softplus.calculateError(0.01, 0.5, -5);
  assert(Number.isFinite(e));
});
