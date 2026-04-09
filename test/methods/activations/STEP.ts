import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { STEP } from "@methods/activations/types/STEP.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("STEP - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "STEP", index: 3 },
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
  const activation = new STEP();
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

Deno.test("STEP - known values", () => {
  const step = new STEP();
  assertEquals(step.squash(1), 1);
  assertEquals(step.squash(0.1), 1);
  assertEquals(step.squash(-1), 0);
  assertEquals(step.squash(-0.1), 0);
});

Deno.test("STEP - output is only 0 or 1", () => {
  const step = new STEP();
  const inputs = [-1000, -1, -0.001, 0.001, 1, 1000];
  for (const x of inputs) {
    const y = step.squash(x);
    assert(y === 0 || y === 1, `STEP(${x}) = ${y} should be 0 or 1`);
  }
});

Deno.test("STEP - edge case at zero", () => {
  const step = new STEP();
  // x = 0 is not > 0, so should return 0
  assertEquals(step.squash(0), 0);
});

Deno.test("STEP - derivative returns pseudo-gradient", () => {
  const step = new STEP();
  // STEP uses a pseudo-gradient for training
  const d = step.derivative(0.5);
  assert(Number.isFinite(d), "STEP derivative should be finite");
});

Deno.test("STEP - unSquash for known outputs", () => {
  const step = new STEP();
  // unSquash(1) should give a positive value
  const recovered1 = step.unSquash(1);
  assert(recovered1 > 0, "unSquash(1) should be positive");
  // unSquash(0) should give a non-positive value
  const recovered0 = step.unSquash(0);
  assert(recovered0 <= 0, "unSquash(0) should be <= 0");
});
