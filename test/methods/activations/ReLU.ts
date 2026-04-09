import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ReLU - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "ReLU", index: 3 },
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
  const activation = new ReLU();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const data = new Float32Array([a]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = activation.squash(a);
    assert(
      Math.abs(expected - actual) < 0.001,
      `${p}) Expected: ${expected}, actual: ${actual}, input: ${a}`,
    );
  }
});

Deno.test("ReLU - known values", () => {
  const relu = new ReLU();
  assertAlmostEquals(relu.squash(0), 0, 1e-10);
  assertAlmostEquals(relu.squash(1), 1, 1e-10);
  assertAlmostEquals(relu.squash(5), 5, 1e-10);
  assertAlmostEquals(relu.squash(-1), 0, 1e-10);
  assertAlmostEquals(relu.squash(-100), 0, 1e-10);
});

Deno.test("ReLU - output range always >= 0", () => {
  const relu = new ReLU();
  const inputs = [-1000, -10, -1, -0.001, 0, 0.001, 1, 10, 1000];
  for (const x of inputs) {
    assert(relu.squash(x) >= 0, `ReLU(${x}) should be >= 0`);
  }
});

Deno.test("ReLU - edge cases", () => {
  const relu = new ReLU();
  assertAlmostEquals(relu.squash(0), 0, 1e-10);
  // Non-finite inputs return 0
  assertAlmostEquals(relu.squash(NaN), 0, 1e-10);
  assertAlmostEquals(relu.squash(Infinity), 0, 1e-10);
  assertAlmostEquals(relu.squash(-Infinity), 0, 1e-10);
});

Deno.test("ReLU - derivative", () => {
  const relu = new ReLU();
  assertEquals(relu.derivative(5), 1);
  assertEquals(relu.derivative(0.1), 1);
  assertEquals(relu.derivative(-1), 0);
  assertEquals(relu.derivative(-100), 0);
});

Deno.test("ReLU - unSquash round-trip for positive values", () => {
  const relu = new ReLU();
  const positiveInputs = [0.1, 0.5, 1, 5, 100];
  for (const x of positiveInputs) {
    const squashed = relu.squash(x);
    const recovered = relu.unSquash(squashed);
    assertAlmostEquals(recovered, x, 1e-6, `unSquash(squash(${x})) should ≈ x`);
  }
});
