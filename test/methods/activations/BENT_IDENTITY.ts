import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { BENT_IDENTITY } from "@methods/activations/types/BENT_IDENTITY.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("BENT_IDENTITY - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "BENT_IDENTITY", index: 3 },
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
  const activation = new BENT_IDENTITY();
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

Deno.test("BENT_IDENTITY - known values", () => {
  const bi = new BENT_IDENTITY();
  // f(0) = (sqrt(1) - 1)/2 + 0 = 0
  assertAlmostEquals(bi.squash(0), 0, 1e-6);
  // f(1) = (sqrt(2) - 1)/2 + 1 ≈ 1.2071
  const expected1 = (Math.sqrt(2) - 1) / 2 + 1;
  assertAlmostEquals(bi.squash(1), expected1, 1e-6);
  // f(-1) = (sqrt(2) - 1)/2 + (-1) ≈ -0.7929
  const expectedNeg1 = (Math.sqrt(2) - 1) / 2 - 1;
  assertAlmostEquals(bi.squash(-1), expectedNeg1, 1e-6);
});

Deno.test("BENT_IDENTITY - edge cases", () => {
  const bi = new BENT_IDENTITY();
  assertAlmostEquals(bi.squash(0), 0, 1e-6);
  assert(Number.isFinite(bi.squash(100)), "should be finite for large input");
  assert(
    Number.isFinite(bi.squash(-100)),
    "should be finite for large negative input",
  );
});

Deno.test("BENT_IDENTITY - derivative", () => {
  const bi = new BENT_IDENTITY();
  // f'(0) = 0/(2*sqrt(1)) + 1 = 1
  assertAlmostEquals(bi.derivative(0), 1, 0.01);
  // Derivative should be positive everywhere
  assert(bi.derivative(5) > 0, "derivative should be positive");
  assert(
    bi.derivative(-5) > 0,
    "derivative should be positive for negative input",
  );
});

Deno.test("BENT_IDENTITY - unSquash round-trip", () => {
  const bi = new BENT_IDENTITY();
  const inputs = [-5, -1, 0, 1, 5];
  for (const x of inputs) {
    const squashed = bi.squash(x);
    const recovered = bi.unSquash(squashed, x);
    assertAlmostEquals(recovered, x, 0.1, `unSquash(squash(${x})) should ≈ x`);
  }
});
