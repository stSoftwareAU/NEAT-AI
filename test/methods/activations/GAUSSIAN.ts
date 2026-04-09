import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { GAUSSIAN } from "@methods/activations/types/GAUSSIAN.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("GAUSSIAN - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "GAUSSIAN", index: 3 },
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
  const activation = new GAUSSIAN();
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

Deno.test("GAUSSIAN - known values", () => {
  const gauss = new GAUSSIAN();
  // f(0) = exp(0) = 1
  assertAlmostEquals(gauss.squash(0), 1, 1e-6);
  // f(1) = exp(-1) ≈ 0.3679
  assertAlmostEquals(gauss.squash(1), Math.exp(-1), 1e-6);
  // Symmetric: f(-x) = f(x)
  assertAlmostEquals(gauss.squash(-1), gauss.squash(1), 1e-6);
});

Deno.test("GAUSSIAN - output range [0, 1]", () => {
  const gauss = new GAUSSIAN();
  const inputs = [-10, -1, 0, 1, 10];
  for (const x of inputs) {
    const y = gauss.squash(x);
    assert(y >= 0 && y <= 1, `GAUSSIAN(${x}) = ${y} should be in [0, 1]`);
  }
});

Deno.test("GAUSSIAN - large values approach 0", () => {
  const gauss = new GAUSSIAN();
  assertAlmostEquals(gauss.squash(10), 0, 0.001);
  assertAlmostEquals(gauss.squash(-10), 0, 0.001);
});

Deno.test("GAUSSIAN - derivative", () => {
  const gauss = new GAUSSIAN();
  // f'(x) = -2x * exp(-x^2)
  assertAlmostEquals(gauss.derivative(0), 0, 1e-6); // f'(0) = 0
  assert(gauss.derivative(1) < 0, "derivative at x=1 should be negative");
  assert(gauss.derivative(-1) > 0, "derivative at x=-1 should be positive");
});
