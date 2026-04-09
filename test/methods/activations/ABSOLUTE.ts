import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { ABSOLUTE } from "@methods/activations/types/ABSOLUTE.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ABSOLUTE - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "ABSOLUTE", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );
  const activation = new ABSOLUTE();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const data = new Float32Array([a]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
    const expected = activation.squash(a);
    assert(
      Math.abs(expected - actual) < 0.001,
      `${p}) Expected: ${expected}, actual: ${actual}, input: ${a}`,
    );
  }
});

Deno.test("ABSOLUTE - known values", () => {
  const abs = new ABSOLUTE();
  assertAlmostEquals(abs.squash(0), 0, 1e-10);
  assertAlmostEquals(abs.squash(5), 5, 1e-10);
  assertAlmostEquals(abs.squash(-5), 5, 1e-10);
  assertAlmostEquals(abs.squash(-0.1), 0.1, 1e-10);
});

Deno.test("ABSOLUTE - output always >= 0", () => {
  const abs = new ABSOLUTE();
  const inputs = [-1000, -1, -0.001, 0, 0.001, 1, 1000];
  for (const x of inputs) {
    assert(abs.squash(x) >= 0, `ABSOLUTE(${x}) should be >= 0`);
  }
});

Deno.test("ABSOLUTE - edge cases", () => {
  const abs = new ABSOLUTE();
  assertAlmostEquals(abs.squash(0), 0, 1e-10);
  // Very large values should still be finite
  assert(Number.isFinite(abs.squash(1000)), "ABSOLUTE(1000) should be finite");
});

Deno.test("ABSOLUTE - derivative", () => {
  const abs = new ABSOLUTE();
  assertAlmostEquals(abs.derivative(5), 1, 1e-10);
  assertAlmostEquals(abs.derivative(-5), -1, 1e-10);
});
