import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { SOFTSIGN } from "@methods/activations/types/SOFTSIGN.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SOFTSIGN - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "SOFTSIGN", index: 3 },
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
  const activation = new SOFTSIGN();
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

Deno.test("SOFTSIGN - known values", () => {
  const ss = new SOFTSIGN();
  // f(0) = 0 / 1 = 0
  assertAlmostEquals(ss.squash(0), 0, 1e-6);
  // f(1) = 1/2 = 0.5
  assertAlmostEquals(ss.squash(1), 0.5, 1e-6);
  // f(-1) = -1/2 = -0.5
  assertAlmostEquals(ss.squash(-1), -0.5, 1e-6);
});

Deno.test("SOFTSIGN - output range approximately (-1, 1)", () => {
  const ss = new SOFTSIGN();
  const inputs = [-1000, -10, -1, 0, 1, 10, 1000];
  for (const x of inputs) {
    const y = ss.squash(x);
    assert(
      y >= -1 && y <= 1,
      `SOFTSIGN(${x}) = ${y} should be in (-1, 1)`,
    );
  }
});

Deno.test("SOFTSIGN - odd function: f(-x) = -f(x)", () => {
  const ss = new SOFTSIGN();
  const inputs = [0.5, 1, 5, 100];
  for (const x of inputs) {
    assertAlmostEquals(
      ss.squash(-x),
      -ss.squash(x),
      1e-6,
      `SOFTSIGN should be odd`,
    );
  }
});

Deno.test("SOFTSIGN - derivative", () => {
  const ss = new SOFTSIGN();
  // f'(x) = 1 / (1 + |x|)^2
  assertAlmostEquals(ss.derivative(0), 1, 1e-6);
  assertAlmostEquals(ss.derivative(1), 0.25, 1e-6);
  // Derivative should always be positive
  assert(ss.derivative(-5) > 0, "derivative should be positive");
});

Deno.test("SOFTSIGN - unSquash round-trip", () => {
  const ss = new SOFTSIGN();
  const inputs = [-2, -1, 0, 1, 2];
  for (const x of inputs) {
    const squashed = ss.squash(x);
    const recovered = ss.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.01, `unSquash(squash(${x})) should ≈ x`);
  }
});
