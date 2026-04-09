import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("LOGISTIC - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "LOGISTIC", index: 3 },
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
  const activation = new LOGISTIC();
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

Deno.test("LOGISTIC - known values", () => {
  const logistic = new LOGISTIC();
  // sigmoid(0) = 0.5
  assertAlmostEquals(logistic.squash(0), 0.5, 1e-6);
  // sigmoid is symmetric: sigmoid(-x) = 1 - sigmoid(x)
  assertAlmostEquals(
    logistic.squash(2) + logistic.squash(-2),
    1.0,
    1e-6,
  );
});

Deno.test("LOGISTIC - output range [0, 1]", () => {
  const logistic = new LOGISTIC();
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = logistic.squash(x);
    assert(y >= 0 && y <= 1, `LOGISTIC(${x}) = ${y} should be in [0, 1]`);
  }
});

Deno.test("LOGISTIC - edge cases", () => {
  const logistic = new LOGISTIC();
  assertAlmostEquals(logistic.squash(0), 0.5, 1e-6);
  // Very large positive approaches 1
  assert(logistic.squash(100) > 0.99, "LOGISTIC(100) should be near 1");
  // Very large negative approaches 0
  assert(logistic.squash(-100) < 0.01, "LOGISTIC(-100) should be near 0");
});

Deno.test("LOGISTIC - derivative", () => {
  const logistic = new LOGISTIC();
  // sigmoid'(0) = sigmoid(0) * (1 - sigmoid(0)) = 0.25
  assertAlmostEquals(logistic.derivative(0), 0.25, 0.01);
  // Derivative is always positive
  assert(logistic.derivative(2) > 0, "LOGISTIC derivative should be > 0");
  assert(logistic.derivative(-2) > 0, "LOGISTIC derivative should be > 0");
});

Deno.test("LOGISTIC - unSquash round-trip", () => {
  const logistic = new LOGISTIC();
  const inputs = [-3, -1, 0, 1, 3];
  for (const x of inputs) {
    const squashed = logistic.squash(x);
    const recovered = logistic.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
