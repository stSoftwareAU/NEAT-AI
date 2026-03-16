/**
 * Benchmark for Math.pow() vs inline multiplication optimisations
 * in activation functions (GAUSSIAN, ISRU, GELU).
 *
 * Measures squash, unSquash, and derivative performance for each
 * affected activation function.
 */
import { GAUSSIAN } from "../../src/methods/activations/types/GAUSSIAN.ts";
import { ISRU } from "../../src/methods/activations/types/ISRU.ts";
import { GELU } from "../../src/methods/activations/types/GELU.ts";

// Pre-generate test data to avoid measuring random number generation
const testValues: number[] = [];
for (let i = 0; i < 1000; i++) {
  testValues.push((Math.random() * 20) - 10);
}

const gaussian = new GAUSSIAN();
const isru = new ISRU();
const gelu = new GELU();

Deno.bench("GAUSSIAN squash (1000 values)", () => {
  for (const x of testValues) {
    gaussian.squash(x);
  }
});

Deno.bench("GAUSSIAN derivative (1000 values)", () => {
  for (const x of testValues) {
    gaussian.derivative(x);
  }
});

Deno.bench("ISRU squash (1000 values)", () => {
  for (const x of testValues) {
    isru.squash(x);
  }
});

Deno.bench("ISRU unSquash (1000 values)", () => {
  for (const x of testValues) {
    const activation = isru.squash(x);
    isru.unSquash(activation, x);
  }
});

Deno.bench("ISRU derivative (1000 values)", () => {
  for (const x of testValues) {
    isru.derivative(x);
  }
});

Deno.bench("GELU squash (1000 values)", () => {
  for (const x of testValues) {
    gelu.squash(x);
  }
});

Deno.bench("GELU derivative (1000 values)", () => {
  for (const x of testValues) {
    gelu.derivative(x);
  }
});
