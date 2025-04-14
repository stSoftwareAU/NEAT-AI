import { GELU } from "../../src/methods/activations/types/GELU.ts";

// Benchmark for GELU unSquash with random values
Deno.bench("GELU unSquash with random values", () => {
  const gelu = new GELU();

  const values: number[] = [];
  for (let i = 0; i < 1000; i++) {
    values.push((Math.random() * 20) - 10);
  }

  for (let i = 0; i < 10; i++) {
    // Test with random values
    for (const value of values) {
      const activation = gelu.squash(value);
      gelu.unSquash(activation, value);
    }
  }
});
