import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { COMPLEMENT } from "@methods/activations/types/COMPLEMENT.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("COMPLEMENT - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "COMPLEMENT", index: 3 },
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
  const activation = new COMPLEMENT();
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

Deno.test("COMPLEMENT - known values (1 - x)", () => {
  const complement = new COMPLEMENT();
  assertAlmostEquals(complement.squash(0), 1, 1e-10);
  assertAlmostEquals(complement.squash(1), 0, 1e-10);
  assertAlmostEquals(complement.squash(0.5), 0.5, 1e-10);
  assertAlmostEquals(complement.squash(-1), 2, 1e-10);
  assertAlmostEquals(complement.squash(2), -1, 1e-10);
});

Deno.test("COMPLEMENT - involution property: complement(complement(x)) = x", () => {
  const complement = new COMPLEMENT();
  const inputs = [-5, -1, 0, 0.5, 1, 5];
  for (const x of inputs) {
    const y = complement.squash(complement.squash(x));
    assertAlmostEquals(
      y,
      x,
      1e-6,
      `complement(complement(${x})) should = ${x}`,
    );
  }
});

Deno.test("COMPLEMENT - edge cases", () => {
  const complement = new COMPLEMENT();
  assertAlmostEquals(complement.squash(0), 1, 1e-10);
  assertAlmostEquals(complement.squash(1), 0, 1e-10);
});

Deno.test("COMPLEMENT - derivative is always -1", () => {
  const complement = new COMPLEMENT();
  assertAlmostEquals(complement.derivative(0), -1, 1e-10);
  assertAlmostEquals(complement.derivative(5), -1, 1e-10);
  assertAlmostEquals(complement.derivative(-5), -1, 1e-10);
});

Deno.test("COMPLEMENT - unSquash round-trip", () => {
  const complement = new COMPLEMENT();
  const inputs = [-5, -1, 0, 0.5, 1, 5];
  for (const x of inputs) {
    const squashed = complement.squash(x);
    const recovered = complement.unSquash(squashed);
    assertAlmostEquals(recovered, x, 1e-6, `unSquash(squash(${x})) should ≈ x`);
  }
});
