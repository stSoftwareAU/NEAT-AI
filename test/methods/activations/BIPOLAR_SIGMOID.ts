import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { BIPOLAR_SIGMOID } from "@methods/activations/types/BIPOLAR_SIGMOID.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("BIPOLAR_SIGMOID - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "BIPOLAR_SIGMOID", index: 3 },
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
  const activation = new BIPOLAR_SIGMOID();
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

Deno.test("BIPOLAR_SIGMOID - known values", () => {
  const bs = new BIPOLAR_SIGMOID();
  // f(0) = 2/(1+1) - 1 = 0
  assertAlmostEquals(bs.squash(0), 0, 1e-6);
  // Odd symmetry: f(-x) ≈ -f(x)
  assertAlmostEquals(
    bs.squash(2) + bs.squash(-2),
    0,
    1e-6,
  );
});

Deno.test("BIPOLAR_SIGMOID - output range [-1, 1]", () => {
  const bs = new BIPOLAR_SIGMOID();
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = bs.squash(x);
    assert(
      y >= -1 && y <= 1,
      `BIPOLAR_SIGMOID(${x}) = ${y} should be in [-1, 1]`,
    );
  }
});

Deno.test("BIPOLAR_SIGMOID - edge cases", () => {
  const bs = new BIPOLAR_SIGMOID();
  assertAlmostEquals(bs.squash(0), 0, 1e-6);
  assert(bs.squash(100) > 0.99, "large positive should approach 1");
  assert(bs.squash(-100) < -0.99, "large negative should approach -1");
});

Deno.test("BIPOLAR_SIGMOID - derivative", () => {
  const bs = new BIPOLAR_SIGMOID();
  // At x=0, derivative is maximum
  const d0 = bs.derivative(0);
  assert(d0 > 0, "derivative at 0 should be positive");
  // Derivative should be positive everywhere
  assert(bs.derivative(2) > 0, "derivative at 2 should be > 0");
});

Deno.test("BIPOLAR_SIGMOID - unSquash round-trip", () => {
  const bs = new BIPOLAR_SIGMOID();
  const inputs = [-2, -1, 0, 1, 2];
  for (const x of inputs) {
    const squashed = bs.squash(x);
    const recovered = bs.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
