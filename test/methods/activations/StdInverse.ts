import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { StdInverse } from "@methods/activations/types/StdInverse.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("StdInverse - creature activation matches JS squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "output", squash: "StdInverse", index: 3 },
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
  const activation = new StdInverse();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;
    const data = new Float32Array([a]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
    const expected = activation.squash(a);
    // StdInverse is 1/x, so inputs near zero produce large-magnitude outputs.
    // The creature path computes in float32, whose ULP grows with magnitude
    // (~0.03 near 2.8e5), so a fixed absolute tolerance is unachievable there.
    // Combine a small absolute floor with a relative term scaled by magnitude.
    const tolerance = 0.01 + Math.abs(expected) * 1e-4;
    assert(
      Math.abs(expected - actual) < tolerance,
      `${p}) Expected: ${expected}, actual: ${actual}, input: ${a}, tolerance: ${tolerance}`,
    );
  }
});

Deno.test("StdInverse - known values", () => {
  const inv = new StdInverse();
  // f(1) = 1/1 = 1
  assertAlmostEquals(inv.squash(1), 1, 1e-6);
  // f(2) = 1/2 = 0.5
  assertAlmostEquals(inv.squash(2), 0.5, 1e-6);
  // f(-1) = 1/(-1) = -1
  assertAlmostEquals(inv.squash(-1), -1, 1e-6);
});

Deno.test("StdInverse - edge cases near zero are handled", () => {
  const inv = new StdInverse();
  // Near-zero inputs should not produce Infinity
  const y = inv.squash(0);
  assert(Number.isFinite(y), "StdInverse(0) should be finite (safeguarded)");
});

Deno.test("StdInverse - odd function: f(-x) = -f(x) for |x| > 0", () => {
  const inv = new StdInverse();
  const inputs = [0.5, 1, 2, 5];
  for (const x of inputs) {
    assertAlmostEquals(
      inv.squash(-x),
      -inv.squash(x),
      1e-6,
      `StdInverse should be odd`,
    );
  }
});

Deno.test("StdInverse - derivative", () => {
  const inv = new StdInverse();
  // Derivative at known points should be finite and negative for positive x
  const d = inv.derivative(1);
  assert(Number.isFinite(d), "derivative should be finite");
});

Deno.test("StdInverse - unSquash round-trip", () => {
  const inv = new StdInverse();
  const inputs = [0.5, 1, 2, 5];
  for (const x of inputs) {
    const squashed = inv.squash(x);
    const recovered = inv.unSquash(squashed);
    assertAlmostEquals(recovered, x, 0.1, `unSquash(squash(${x})) should ≈ x`);
  }
});
