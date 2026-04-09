import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { SQUARE } from "@methods/activations/types/SQUARE.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SQUARE - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "SQUARE", index: 3 },
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
  const activation = new SQUARE();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const data = new Float32Array([a]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
    const expected = activation.squash(a);
    assert(
      Math.abs(expected - actual) < 0.01,
      `${p}) Expected: ${expected}, actual: ${actual}, input: ${a}`,
    );
  }
});

Deno.test("SQUARE - known values", () => {
  const square = new SQUARE();
  assertAlmostEquals(square.squash(0), 0, 1e-10);
  assertAlmostEquals(square.squash(2), 4, 1e-6);
  assertAlmostEquals(square.squash(-2), 4, 1e-6);
  assertAlmostEquals(square.squash(3), 9, 1e-6);
});

Deno.test("SQUARE - output always >= 0", () => {
  const square = new SQUARE();
  const inputs = [-10, -1, -0.001, 0, 0.001, 1, 10];
  for (const x of inputs) {
    assert(square.squash(x) >= 0, `SQUARE(${x}) should be >= 0`);
  }
});

Deno.test("SQUARE - even function: f(-x) = f(x)", () => {
  const square = new SQUARE();
  const inputs = [0.5, 1, 2, 5];
  for (const x of inputs) {
    assertAlmostEquals(
      square.squash(-x),
      square.squash(x),
      1e-6,
      `SQUARE should be even: f(-${x}) = f(${x})`,
    );
  }
});

Deno.test("SQUARE - derivative", () => {
  const square = new SQUARE();
  // f'(x) = 2x
  assertAlmostEquals(square.derivative(0), 0, 1e-6);
  assertAlmostEquals(square.derivative(1), 2, 1e-6);
  assertAlmostEquals(square.derivative(3), 6, 1e-6);
  assertAlmostEquals(square.derivative(-2), -4, 1e-6);
});
