import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { LogSigmoid } from "@methods/activations/types/LogSigmoid.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("LogSigmoid - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "LogSigmoid", index: 3 },
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
  const activation = new LogSigmoid();
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

Deno.test("LogSigmoid - known values", () => {
  const ls = new LogSigmoid();
  // f(0) = -log(1 + 1) = -log(2) ≈ -0.6931
  assertAlmostEquals(ls.squash(0), -Math.log(2), 1e-6);
  // For large positive x, approaches 0
  assert(ls.squash(10) > -0.01, "LogSigmoid(10) should be near 0");
  // Always negative
  assert(ls.squash(0) < 0, "LogSigmoid(0) should be < 0");
});

Deno.test("LogSigmoid - output always <= 0", () => {
  const ls = new LogSigmoid();
  const inputs = [-100, -10, -1, 0, 1, 10, 100];
  for (const x of inputs) {
    assert(ls.squash(x) <= 0, `LogSigmoid(${x}) should be <= 0`);
  }
});

Deno.test("LogSigmoid - monotonically increasing", () => {
  const ls = new LogSigmoid();
  const sorted = [-5, -2, -1, 0, 1, 2, 5];
  for (let i = 1; i < sorted.length; i++) {
    assert(
      ls.squash(sorted[i]) >= ls.squash(sorted[i - 1]),
      `LogSigmoid should be monotonically increasing`,
    );
  }
});

Deno.test("LogSigmoid - derivative", () => {
  const ls = new LogSigmoid();
  // f'(x) = 1 - sigmoid(x) = sigmoid(-x)
  // At x=0: 1 - 0.5 = 0.5
  assertAlmostEquals(ls.derivative(0), 0.5, 0.01);
  // Derivative should be positive
  assert(ls.derivative(2) > 0, "derivative should be positive");
});

Deno.test("LogSigmoid - unSquash round-trip", () => {
  const ls = new LogSigmoid();
  const inputs = [-3, -1, 0, 1, 3];
  for (const x of inputs) {
    const squashed = ls.squash(x);
    const recovered = ls.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
