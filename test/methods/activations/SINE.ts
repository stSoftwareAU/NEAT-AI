import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { SINE } from "@methods/activations/types/SINE.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SINE - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "SINE", index: 3 },
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
  const activation = new SINE();
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

Deno.test("SINE - known values", () => {
  const sine = new SINE();
  assertAlmostEquals(sine.squash(0), 0, 1e-6);
  assertAlmostEquals(sine.squash(Math.PI / 2), 1, 1e-6);
  assertAlmostEquals(sine.squash(-Math.PI / 2), -1, 1e-6);
  assertAlmostEquals(sine.squash(Math.PI), 0, 1e-6);
});

Deno.test("SINE - output range [-1, 1]", () => {
  const sine = new SINE();
  const inputs = [-10, -Math.PI, -1, 0, 1, Math.PI, 10];
  for (const x of inputs) {
    const y = sine.squash(x);
    assert(y >= -1 && y <= 1, `SINE(${x}) = ${y} should be in [-1, 1]`);
  }
});

Deno.test("SINE - odd function: f(-x) = -f(x)", () => {
  const sine = new SINE();
  const inputs = [0.5, 1, 2];
  for (const x of inputs) {
    assertAlmostEquals(
      sine.squash(-x),
      -sine.squash(x),
      1e-6,
      `SINE should be odd: f(-${x}) = -f(${x})`,
    );
  }
});

Deno.test("SINE - derivative", () => {
  const sine = new SINE();
  // sin'(x) = cos(x)
  assertAlmostEquals(sine.derivative(0), 1, 1e-6); // cos(0) = 1
  assertAlmostEquals(sine.derivative(Math.PI / 2), 0, 1e-6); // cos(pi/2) = 0
});
