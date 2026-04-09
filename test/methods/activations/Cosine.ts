import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { Cosine } from "@methods/activations/types/Cosine.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Cosine - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "Cosine", index: 3 },
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
  const activation = new Cosine();
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

Deno.test("Cosine - known values", () => {
  const cos = new Cosine();
  assertAlmostEquals(cos.squash(0), 1, 1e-6);
  assertAlmostEquals(cos.squash(Math.PI), -1, 1e-6);
  assertAlmostEquals(cos.squash(Math.PI / 2), 0, 1e-6);
});

Deno.test("Cosine - output range [-1, 1]", () => {
  const cos = new Cosine();
  const inputs = [-10, -Math.PI, -1, 0, 1, Math.PI, 10];
  for (const x of inputs) {
    const y = cos.squash(x);
    assert(y >= -1 && y <= 1, `Cosine(${x}) = ${y} should be in [-1, 1]`);
  }
});

Deno.test("Cosine - derivative", () => {
  const cos = new Cosine();
  // cos'(x) = -sin(x)
  assertAlmostEquals(cos.derivative(0), 0, 1e-6); // -sin(0) = 0
  assertAlmostEquals(cos.derivative(Math.PI / 2), -1, 1e-6); // -sin(pi/2) = -1
});
