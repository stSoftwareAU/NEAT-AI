import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { Cube } from "@methods/activations/types/Cube.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Cube - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "Cube", index: 3 },
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
  const activation = new Cube();
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

Deno.test("Cube - known values", () => {
  const cube = new Cube();
  assertAlmostEquals(cube.squash(0), 0, 1e-10);
  assertAlmostEquals(cube.squash(2), 8, 1e-6);
  assertAlmostEquals(cube.squash(-2), -8, 1e-6);
  assertAlmostEquals(cube.squash(1), 1, 1e-6);
});

Deno.test("Cube - odd function: f(-x) = -f(x)", () => {
  const cube = new Cube();
  const inputs = [0.5, 1, 2, 5];
  for (const x of inputs) {
    assertAlmostEquals(
      cube.squash(-x),
      -cube.squash(x),
      1e-6,
      `Cube should be an odd function: f(-${x}) = -f(${x})`,
    );
  }
});

Deno.test("Cube - derivative", () => {
  const cube = new Cube();
  // f'(x) = 3x^2
  assertAlmostEquals(cube.derivative(0), 0, 1e-6);
  assertAlmostEquals(cube.derivative(1), 3, 1e-6);
  assertAlmostEquals(cube.derivative(2), 12, 1e-6);
});

Deno.test("Cube - unSquash round-trip", () => {
  const cube = new Cube();
  const inputs = [-2, -1, 0, 1, 2];
  for (const x of inputs) {
    const squashed = cube.squash(x);
    const recovered = cube.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
