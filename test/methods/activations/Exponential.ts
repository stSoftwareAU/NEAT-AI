import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { Exponential } from "@methods/activations/types/Exponential.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Exponential - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "Exponential", index: 3 },
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
  const activation = new Exponential();
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

Deno.test("Exponential - known values", () => {
  const exp = new Exponential();
  assertAlmostEquals(exp.squash(0), 1, 1e-6);
  assertAlmostEquals(exp.squash(1), Math.E, 0.01);
  // Negative x gives values between 0 and 1
  assert(
    exp.squash(-1) > 0 && exp.squash(-1) < 1,
    "exp(-1) should be in (0, 1)",
  );
});

Deno.test("Exponential - output always > 0", () => {
  const exp = new Exponential();
  const inputs = [-100, -10, -1, 0, 1, 10];
  for (const x of inputs) {
    assert(exp.squash(x) > 0, `Exponential(${x}) should be > 0`);
  }
});

Deno.test("Exponential - large positive input is clamped", () => {
  const exp = new Exponential();
  // Implementation clamps at x=36 to prevent overflow
  const y = exp.squash(1000);
  assert(Number.isFinite(y), "Exponential(1000) should be finite (clamped)");
});

Deno.test("Exponential - derivative", () => {
  const exp = new Exponential();
  // exp'(x) = exp(x)
  assertAlmostEquals(exp.derivative(0), 1, 1e-6);
  assert(exp.derivative(1) > 2, "exp derivative at 1 should be > 2");
});

Deno.test("Exponential - unSquash round-trip", () => {
  const exp = new Exponential();
  const inputs = [-2, -1, 0, 1, 2];
  for (const x of inputs) {
    const squashed = exp.squash(x);
    const recovered = exp.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
