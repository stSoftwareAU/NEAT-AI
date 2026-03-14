/**
 * Tests verifying that activation function outputs remain correct
 * after Math.pow() and constant recomputation optimisations.
 *
 * Tests cover squash, unSquash, and derivative for GAUSSIAN, ISRU, and GELU.
 *
 * @module
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { GAUSSIAN } from "../../../src/methods/activations/types/GAUSSIAN.ts";
import { ISRU } from "../../../src/methods/activations/types/ISRU.ts";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";

// --- GAUSSIAN ---

Deno.test("GAUSSIAN squash produces exp(-x²) for typical inputs", () => {
  const g = new GAUSSIAN();

  // f(0) = exp(0) = 1
  assertAlmostEquals(g.squash(0), 1, 1e-10);

  // f(1) = exp(-1) ≈ 0.3679
  assertAlmostEquals(g.squash(1), Math.exp(-1), 1e-10);

  // f(-1) = exp(-1) ≈ 0.3679
  assertAlmostEquals(g.squash(-1), Math.exp(-1), 1e-10);

  // f(2) = exp(-4) ≈ 0.01832
  assertAlmostEquals(g.squash(2), Math.exp(-4), 1e-10);
});

Deno.test("GAUSSIAN squash handles large values", () => {
  const g = new GAUSSIAN();

  // Very large inputs should return ~0
  assertAlmostEquals(g.squash(50), 0, 1e-10);
  assertAlmostEquals(g.squash(-50), 0, 1e-10);
});

Deno.test("GAUSSIAN squash handles non-finite input", () => {
  const g = new GAUSSIAN();
  assertEquals(g.squash(Infinity), 0);
  assertEquals(g.squash(-Infinity), 0);
  assertEquals(g.squash(NaN), 0);
});

Deno.test("GAUSSIAN derivative produces -2x*exp(-x²)", () => {
  const g = new GAUSSIAN();

  // f'(0) = 0
  assertAlmostEquals(g.derivative(0), 0, 1e-10);

  // f'(1) = -2 * exp(-1) ≈ -0.7358
  assertAlmostEquals(g.derivative(1), -2 * Math.exp(-1), 1e-10);

  // f'(-1) = 2 * exp(-1) ≈ 0.7358
  assertAlmostEquals(g.derivative(-1), 2 * Math.exp(-1), 1e-10);
});

// --- ISRU ---

Deno.test("ISRU squash produces x/sqrt(1+x²) for typical inputs", () => {
  const isru = new ISRU();

  // f(0) = 0
  assertAlmostEquals(isru.squash(0), 0, 1e-10);

  // f(1) = 1/sqrt(2) ≈ 0.7071
  assertAlmostEquals(isru.squash(1), 1 / Math.sqrt(2), 1e-10);

  // f(-1) = -1/sqrt(2)
  assertAlmostEquals(isru.squash(-1), -1 / Math.sqrt(2), 1e-10);

  // f(3) = 3/sqrt(10)
  assertAlmostEquals(isru.squash(3), 3 / Math.sqrt(10), 1e-10);
});

Deno.test("ISRU unSquash roundtrips with squash", () => {
  const isru = new ISRU();
  const inputs = [-3, -1, -0.5, 0, 0.5, 1, 3];

  for (const x of inputs) {
    const activation = isru.squash(x);
    const recovered = isru.unSquash(activation, x);
    assertAlmostEquals(recovered, x, 1e-6);
  }
});

Deno.test("ISRU derivative produces (1+αx²)^(-3/2)", () => {
  const isru = new ISRU();

  // f'(0) = 1
  assertAlmostEquals(isru.derivative(0), 1, 1e-10);

  // f'(1) = (1+1)^(-1.5) = 2^(-1.5) ≈ 0.3536
  assertAlmostEquals(isru.derivative(1), Math.pow(2, -1.5), 1e-10);

  // f'(2) = (1+4)^(-1.5) = 5^(-1.5)
  assertAlmostEquals(isru.derivative(2), Math.pow(5, -1.5), 1e-10);
});

// --- GELU ---

Deno.test("GELU squash produces correct approximation", () => {
  const gelu = new GELU();

  // f(0) = 0 (exactly)
  assertAlmostEquals(gelu.squash(0), 0, 1e-10);

  // f(1) ≈ 0.8412 (known GELU value)
  assertAlmostEquals(gelu.squash(1), 0.8412, 1e-3);

  // f(-1) ≈ -0.1588
  assertAlmostEquals(gelu.squash(-1), -0.1588, 1e-3);

  // Large positive: f(x) ≈ x
  assertAlmostEquals(gelu.squash(5), 5, 0.01);
});

Deno.test("GELU squash handles extreme inputs", () => {
  const gelu = new GELU();

  // Very large negative → ~0
  assertEquals(gelu.squash(-20), -0);

  // Very large positive → ~x
  const result = gelu.squash(20);
  assertAlmostEquals(result, 20, 1);
});

Deno.test("GELU derivative produces correct values", () => {
  const gelu = new GELU();

  // f'(0) ≈ 0.5
  assertAlmostEquals(gelu.derivative(0), 0.5, 1e-3);

  // f'(1) ≈ 1.083
  assertAlmostEquals(gelu.derivative(1), 1.083, 0.01);

  // f'(-1) ≈ -0.083
  assertAlmostEquals(gelu.derivative(-1), -0.083, 0.01);
});

Deno.test("GELU unSquash roundtrips with squash", () => {
  const gelu = new GELU();
  const inputs = [-2, -1, -0.5, 0.5, 1, 2, 5];

  for (const x of inputs) {
    const activation = gelu.squash(x);
    const recovered = gelu.unSquash(activation, x);
    assertAlmostEquals(recovered, x, 0.01);
  }
});
