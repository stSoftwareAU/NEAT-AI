import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { SQRT } from "@methods/activations/types/SQRT.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SQRT - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "SQRT", index: 3 },
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
  const activation = new SQRT();
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

Deno.test("SQRT - known values", () => {
  const sqrt = new SQRT();
  assertAlmostEquals(sqrt.squash(0), 0, 1e-6);
  assertAlmostEquals(sqrt.squash(1), 1, 1e-6);
  assertAlmostEquals(sqrt.squash(4), 2, 1e-6);
  assertAlmostEquals(sqrt.squash(9), 3, 1e-6);
});

Deno.test("SQRT - output always >= 0", () => {
  const sqrt = new SQRT();
  const inputs = [-10, -1, 0, 1, 10, 100];
  for (const x of inputs) {
    assert(sqrt.squash(x) >= 0, `SQRT(${x}) should be >= 0`);
  }
});

Deno.test("SQRT - negative inputs return 0", () => {
  const sqrt = new SQRT();
  assertAlmostEquals(sqrt.squash(-1), 0, 1e-6);
  assertAlmostEquals(sqrt.squash(-100), 0, 1e-6);
});

Deno.test("SQRT - derivative", () => {
  const sqrt = new SQRT();
  // f'(x) = 1/(2*sqrt(x)) for x > 0
  assertAlmostEquals(sqrt.derivative(1), 0.5, 1e-6);
  assertAlmostEquals(sqrt.derivative(4), 0.25, 1e-6);
});

Deno.test("SQRT - unSquash round-trip for positive values", () => {
  const sqrt = new SQRT();
  const inputs = [0.5, 1, 4, 9];
  for (const x of inputs) {
    const squashed = sqrt.squash(x);
    const recovered = sqrt.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
