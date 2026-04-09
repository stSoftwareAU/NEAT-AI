import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { SELU } from "@methods/activations/types/SELU.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SELU - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "SELU", index: 3 },
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
  const activation = new SELU();
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

Deno.test("SELU - known values", () => {
  const selu = new SELU();
  // SELU(0) should be 0 (both branches give 0 at x=0)
  assertAlmostEquals(selu.squash(0), 0, 1e-6);
  // For positive x: SELU(x) = SCALE * x ≈ 1.0507 * x
  assert(selu.squash(1) > 1, "SELU(1) should be > 1 due to scale factor");
  // For negative x: output should be negative
  assert(selu.squash(-1) < 0, "SELU(-1) should be negative");
});

Deno.test("SELU - output is self-normalising for positive inputs", () => {
  const selu = new SELU();
  // SELU preserves positive scaling: squash(x) > x for x > 0
  const x = 2;
  assert(selu.squash(x) > x, `SELU(${x}) should be > ${x}`);
});

Deno.test("SELU - edge cases", () => {
  const selu = new SELU();
  assertAlmostEquals(selu.squash(0), 0, 1e-6);
  // Very large negative values should saturate
  const largeNeg = selu.squash(-100);
  assert(largeNeg < 0, "SELU(-100) should be negative");
  assert(Number.isFinite(largeNeg), "SELU(-100) should be finite");
});

Deno.test("SELU - derivative", () => {
  const selu = new SELU();
  // For x > 0, derivative is SCALE ≈ 1.0507
  assert(selu.derivative(1) > 1, "SELU derivative at x=1 should be > 1");
  // For x < 0, derivative should be positive (SCALE * ALPHA * exp(x))
  assert(selu.derivative(-1) > 0, "SELU derivative at x=-1 should be > 0");
});

Deno.test("SELU - unSquash round-trip", () => {
  const selu = new SELU();
  const inputs = [-1, -0.5, 0, 0.5, 1, 2];
  for (const x of inputs) {
    const squashed = selu.squash(x);
    const recovered = selu.unSquash(squashed, x);
    assertAlmostEquals(recovered, x, 0.1, `unSquash(squash(${x})) should ≈ x`);
  }
});
