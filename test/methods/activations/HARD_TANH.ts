import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { HARD_TANH } from "@methods/activations/types/HARD_TANH.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("HARD_TANH - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "HARD_TANH", index: 3 },
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
  const activation = new HARD_TANH();
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

Deno.test("HARD_TANH - known values", () => {
  const ht = new HARD_TANH();
  assertAlmostEquals(ht.squash(0), 0, 1e-10);
  assertAlmostEquals(ht.squash(0.5), 0.5, 1e-10);
  assertAlmostEquals(ht.squash(-0.5), -0.5, 1e-10);
  assertAlmostEquals(ht.squash(2), 1, 1e-10);
  assertAlmostEquals(ht.squash(-2), -1, 1e-10);
});

Deno.test("HARD_TANH - output range [-1, 1]", () => {
  const ht = new HARD_TANH();
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = ht.squash(x);
    assert(y >= -1 && y <= 1, `HARD_TANH(${x}) = ${y} should be in [-1, 1]`);
  }
});

Deno.test("HARD_TANH - linear in [-1, 1]", () => {
  const ht = new HARD_TANH();
  // Within [-1, 1], HARD_TANH is identity
  const inputs = [-0.9, -0.5, 0, 0.5, 0.9];
  for (const x of inputs) {
    assertAlmostEquals(ht.squash(x), x, 1e-10, `HARD_TANH(${x}) should = ${x}`);
  }
});

Deno.test("HARD_TANH - derivative", () => {
  const ht = new HARD_TANH();
  // Within (-1, 1), derivative is 1; outside is 0
  assertAlmostEquals(ht.derivative(0.5), 1, 1e-6);
  assertAlmostEquals(ht.derivative(-0.5), 1, 1e-6);
  assertAlmostEquals(ht.derivative(2), 0, 1e-6);
  assertAlmostEquals(ht.derivative(-2), 0, 1e-6);
});

Deno.test("HARD_TANH - unSquash round-trip", () => {
  const ht = new HARD_TANH();
  // Within the linear region, round-trip should be exact
  const inputs = [-0.5, 0, 0.5];
  for (const x of inputs) {
    const squashed = ht.squash(x);
    const recovered = ht.unSquash(squashed);
    assertAlmostEquals(recovered, x, 1e-6, `unSquash(squash(${x})) should ≈ x`);
  }
});
