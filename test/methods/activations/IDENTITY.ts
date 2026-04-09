import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("IDENTITY - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "IDENTITY", index: 3 },
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
  const activation = new IDENTITY();
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

Deno.test("IDENTITY - known values (pass-through)", () => {
  const identity = new IDENTITY();
  assertAlmostEquals(identity.squash(0), 0, 1e-10);
  assertAlmostEquals(identity.squash(1), 1, 1e-10);
  assertAlmostEquals(identity.squash(-1), -1, 1e-10);
  assertAlmostEquals(identity.squash(42.5), 42.5, 1e-10);
  assertAlmostEquals(identity.squash(-99.9), -99.9, 1e-10);
});

Deno.test("IDENTITY - edge cases", () => {
  const identity = new IDENTITY();
  assertAlmostEquals(identity.squash(0), 0, 1e-10);
});

Deno.test("IDENTITY - derivative is always 1", () => {
  const identity = new IDENTITY();
  assertAlmostEquals(identity.derivative(0), 1, 1e-10);
  assertAlmostEquals(identity.derivative(100), 1, 1e-10);
  assertAlmostEquals(identity.derivative(-100), 1, 1e-10);
});

Deno.test("IDENTITY - unSquash round-trip", () => {
  const identity = new IDENTITY();
  const inputs = [-10, -1, 0, 1, 10];
  for (const x of inputs) {
    const squashed = identity.squash(x);
    const recovered = identity.unSquash(squashed);
    assertAlmostEquals(
      recovered,
      x,
      1e-10,
      `unSquash(squash(${x})) should = x`,
    );
  }
});
