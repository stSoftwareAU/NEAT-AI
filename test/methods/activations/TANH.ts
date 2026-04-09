import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { TANH } from "@methods/activations/types/TANH.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TANH - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "TANH", index: 3 },
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
  const activation = new TANH();
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

Deno.test("TANH - known values", () => {
  const tanh = new TANH();
  assertAlmostEquals(tanh.squash(0), 0, 1e-6);
  // tanh is odd: tanh(-x) = -tanh(x)
  assertAlmostEquals(
    tanh.squash(1) + tanh.squash(-1),
    0,
    1e-6,
  );
  assertAlmostEquals(tanh.squash(1), Math.tanh(1), 1e-6);
});

Deno.test("TANH - output range [-1, 1]", () => {
  const tanh = new TANH();
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = tanh.squash(x);
    assert(y >= -1 && y <= 1, `TANH(${x}) = ${y} should be in [-1, 1]`);
  }
});

Deno.test("TANH - edge cases", () => {
  const tanh = new TANH();
  assertAlmostEquals(tanh.squash(0), 0, 1e-6);
  // Large positive approaches 1
  assertAlmostEquals(tanh.squash(100), 1, 0.001);
  // Large negative approaches -1
  assertAlmostEquals(tanh.squash(-100), -1, 0.001);
});

Deno.test("TANH - derivative", () => {
  const tanh = new TANH();
  // tanh'(0) = 1 - tanh(0)^2 = 1
  assertAlmostEquals(tanh.derivative(0), 1, 0.01);
  // Derivative is always positive and <= 1
  const d = tanh.derivative(1);
  assert(d > 0 && d <= 1, `TANH derivative at 1 should be in (0, 1], got ${d}`);
});

Deno.test("TANH - unSquash round-trip", () => {
  const tanh = new TANH();
  const inputs = [-1.5, -0.5, 0, 0.5, 1.5];
  for (const x of inputs) {
    const squashed = tanh.squash(x);
    const recovered = tanh.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
