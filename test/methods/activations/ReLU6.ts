import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { ReLU6 } from "@methods/activations/types/ReLU6.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ReLU6 - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "ReLU6", index: 3 },
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
  const activation = new ReLU6();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 14 - 4;
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

Deno.test("ReLU6 - known values", () => {
  const relu6 = new ReLU6();
  assertAlmostEquals(relu6.squash(0), 0, 1e-10);
  assertAlmostEquals(relu6.squash(3), 3, 1e-10);
  assertAlmostEquals(relu6.squash(6), 6, 1e-10);
  assertAlmostEquals(relu6.squash(10), 6, 1e-10);
  assertAlmostEquals(relu6.squash(-5), 0, 1e-10);
});

Deno.test("ReLU6 - output range [0, 6]", () => {
  const relu6 = new ReLU6();
  const inputs = [-1000, -10, -1, 0, 1, 3, 6, 10, 1000];
  for (const x of inputs) {
    const y = relu6.squash(x);
    assert(y >= 0 && y <= 6, `ReLU6(${x}) = ${y} should be in [0, 6]`);
  }
});

Deno.test("ReLU6 - edge cases", () => {
  const relu6 = new ReLU6();
  assertAlmostEquals(relu6.squash(0), 0, 1e-10);
  assertAlmostEquals(relu6.squash(6), 6, 1e-10);
});

Deno.test("ReLU6 - derivative", () => {
  const relu6 = new ReLU6();
  assertAlmostEquals(relu6.derivative(3), 1, 1e-10);
  assertAlmostEquals(relu6.derivative(-1), 0, 1e-10);
  assertAlmostEquals(relu6.derivative(7), 0, 1e-10);
});

Deno.test("ReLU6 - unSquash round-trip", () => {
  const relu6 = new ReLU6();
  const inputs = [0.5, 1, 3, 5.5];
  for (const x of inputs) {
    const squashed = relu6.squash(x);
    const recovered = relu6.unSquash(squashed);
    assertAlmostEquals(recovered, x, 1e-6, `unSquash(squash(${x})) should ≈ x`);
  }
});
