import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { ISRU } from "@methods/activations/types/ISRU.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ISRU - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "ISRU", index: 3 },
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
  const activation = new ISRU();
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

Deno.test("ISRU - known values", () => {
  const isru = new ISRU();
  // f(0) = 0 / sqrt(1) = 0
  assertAlmostEquals(isru.squash(0), 0, 1e-6);
  // f(1) = 1 / sqrt(2) ≈ 0.7071
  assertAlmostEquals(isru.squash(1), 1 / Math.sqrt(2), 1e-6);
  // Odd function: f(-x) = -f(x)
  assertAlmostEquals(isru.squash(-1), -1 / Math.sqrt(2), 1e-6);
});

Deno.test("ISRU - output range [-1, 1]", () => {
  const isru = new ISRU();
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = isru.squash(x);
    assert(y >= -1 && y <= 1, `ISRU(${x}) = ${y} should be in [-1, 1]`);
  }
});

Deno.test("ISRU - edge cases", () => {
  const isru = new ISRU();
  assertAlmostEquals(isru.squash(0), 0, 1e-6);
  // Large values should approach ±1
  assert(isru.squash(1000) > 0.99, "ISRU(1000) should approach 1");
  assert(isru.squash(-1000) < -0.99, "ISRU(-1000) should approach -1");
});

Deno.test("ISRU - derivative", () => {
  const isru = new ISRU();
  // f'(0) = (1+0)^(-3/2) = 1
  assertAlmostEquals(isru.derivative(0), 1, 1e-6);
  // Derivative should be positive everywhere
  assert(isru.derivative(1) > 0, "derivative at 1 should be > 0");
  assert(isru.derivative(-1) > 0, "derivative at -1 should be > 0");
});

Deno.test("ISRU - unSquash round-trip", () => {
  const isru = new ISRU();
  const inputs = [-2, -1, 0, 1, 2];
  for (const x of inputs) {
    const squashed = isru.squash(x);
    const recovered = isru.unSquash(squashed, x);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
