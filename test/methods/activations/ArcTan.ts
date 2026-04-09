import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { ArcTan } from "@methods/activations/types/ArcTan.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ArcTan - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "ArcTan", index: 3 },
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
  const activation = new ArcTan();
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

Deno.test("ArcTan - known values", () => {
  const arctan = new ArcTan();
  assertAlmostEquals(arctan.squash(0), 0, 1e-6);
  assertAlmostEquals(arctan.squash(1), Math.PI / 4, 1e-6);
  assertAlmostEquals(arctan.squash(-1), -Math.PI / 4, 1e-6);
});

Deno.test("ArcTan - output range (-pi/2, pi/2)", () => {
  const arctan = new ArcTan();
  const halfPi = Math.PI / 2;
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = arctan.squash(x);
    assert(
      y >= -halfPi && y <= halfPi,
      `ArcTan(${x}) = ${y} should be in [-pi/2, pi/2]`,
    );
  }
});

Deno.test("ArcTan - derivative", () => {
  const arctan = new ArcTan();
  // arctan'(x) = 1 / (1 + x^2)
  assertAlmostEquals(arctan.derivative(0), 1, 1e-6);
  assertAlmostEquals(arctan.derivative(1), 0.5, 1e-6);
});

Deno.test("ArcTan - unSquash round-trip", () => {
  const arctan = new ArcTan();
  const inputs = [-3, -1, 0, 1, 3];
  for (const x of inputs) {
    const squashed = arctan.squash(x);
    const recovered = arctan.unSquash(squashed);
    assertAlmostEquals(recovered, x, 1e-6, `unSquash(squash(${x})) should ≈ x`);
  }
});
