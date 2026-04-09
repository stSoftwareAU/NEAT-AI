import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { GELU } from "@methods/activations/types/GELU.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("GELU - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "GELU", index: 3 },
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
  const activation = new GELU();
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

Deno.test("GELU - known values", () => {
  const gelu = new GELU();
  // GELU(0) ≈ 0
  assertAlmostEquals(gelu.squash(0), 0, 1e-6);
  // GELU is approximately x for large positive x
  assert(gelu.squash(3) > 2.9, "GELU(3) should be close to 3");
  // GELU has a minimum around x ≈ -0.17
  assert(gelu.squash(-1) < 0, "GELU(-1) should be negative");
});

Deno.test("GELU - output range lower bound", () => {
  const gelu = new GELU();
  // GELU minimum is approximately -0.17
  const inputs = [-10, -5, -2, -1, -0.5, 0, 0.5, 1, 5, 10];
  for (const x of inputs) {
    const y = gelu.squash(x);
    assert(
      y >= -0.18,
      `GELU(${x}) = ${y} should be >= -0.18 (approx lower bound)`,
    );
  }
});

Deno.test("GELU - edge cases", () => {
  const gelu = new GELU();
  assertAlmostEquals(gelu.squash(0), 0, 1e-6);
  // Very large negative should approach 0
  const largeNeg = gelu.squash(-10);
  assertAlmostEquals(largeNeg, 0, 0.01, "GELU(-10) should be near 0");
});

Deno.test("GELU - derivative", () => {
  const gelu = new GELU();
  // At x=0, GELU'(0) ≈ 0.5
  assertAlmostEquals(gelu.derivative(0), 0.5, 0.01);
  // For large positive x, derivative approaches 1
  assert(
    gelu.derivative(5) > 0.99,
    "GELU derivative for large positive should approach 1",
  );
});

Deno.test("GELU - unSquash round-trip for positive values", () => {
  const gelu = new GELU();
  const inputs = [0.5, 1, 2, 3];
  for (const x of inputs) {
    const squashed = gelu.squash(x);
    const recovered = gelu.unSquash(squashed, x);
    assertAlmostEquals(recovered, x, 0.1, `unSquash(squash(${x})) should ≈ x`);
  }
});
