import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { BIPOLAR } from "@methods/activations/types/BIPOLAR.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("BIPOLAR - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "BIPOLAR", index: 3 },
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
  const activation = new BIPOLAR();
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

Deno.test("BIPOLAR - known values", () => {
  const bipolar = new BIPOLAR();
  assertEquals(bipolar.squash(1), 1);
  assertEquals(bipolar.squash(0.001), 1);
  assertEquals(bipolar.squash(-1), -1);
  assertEquals(bipolar.squash(-0.001), -1);
});

Deno.test("BIPOLAR - output is only -1 or 1", () => {
  const bipolar = new BIPOLAR();
  const inputs = [-1000, -1, -0.001, 0.001, 1, 1000];
  for (const x of inputs) {
    const y = bipolar.squash(x);
    assert(y === -1 || y === 1, `BIPOLAR(${x}) = ${y} should be -1 or 1`);
  }
});

Deno.test("BIPOLAR - edge case at zero", () => {
  const bipolar = new BIPOLAR();
  // x = 0 is not > 0, so should return -1
  assertEquals(bipolar.squash(0), -1);
});

Deno.test("BIPOLAR - derivative is always 0", () => {
  const bipolar = new BIPOLAR();
  assertEquals(bipolar.derivative(0), 0);
  assertEquals(bipolar.derivative(5), 0);
  assertEquals(bipolar.derivative(-5), 0);
});
