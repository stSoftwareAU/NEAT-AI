import { assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Unit tests for Mutator.calculateMaxSynapses method.
 *
 * Issue #1397: Verify the mathematical calculation of the maximum
 * number of synapses considering that observation neurons do not
 * connect to each other.
 */

function createMutator(overrides: Record<string, unknown> = {}) {
  const config = createNeatConfig({ populationSize: 10, ...overrides });
  return new Mutator(config);
}

Deno.test("calculateMaxSynapses: no hidden neurons", () => {
  const mutator = createMutator();

  // With 3 observations, 0 hidden, 2 outputs:
  // obs -> outputs: 3 * 2 = 6
  // Total: 6
  const result = mutator.calculateMaxSynapses(3, 0, 2);
  assertEquals(result, 6);
});

Deno.test("calculateMaxSynapses: single hidden neuron", () => {
  const mutator = createMutator();

  // With 2 observations, 1 hidden, 1 output:
  // obs -> hidden: 2 * 1 = 2
  // obs -> outputs: 2 * 1 = 2
  // hidden -> hidden: (1 * 0) / 2 = 0
  // hidden -> outputs: 1 * 1 = 1
  // Total: 2 + 2 + 0 + 1 = 5
  const result = mutator.calculateMaxSynapses(2, 1, 1);
  assertEquals(result, 5);
});

Deno.test("calculateMaxSynapses: two hidden neurons", () => {
  const mutator = createMutator();

  // With 3 observations, 2 hidden, 2 outputs:
  // obs -> hidden: 3 * 2 = 6
  // obs -> outputs: 3 * 2 = 6
  // hidden -> hidden: (2 * 1) / 2 = 1
  // hidden -> outputs: 2 * 2 = 4
  // Total: 6 + 6 + 1 + 4 = 17
  const result = mutator.calculateMaxSynapses(3, 2, 2);
  assertEquals(result, 17);
});

Deno.test("calculateMaxSynapses: many hidden neurons", () => {
  const mutator = createMutator();

  // With 5 observations, 10 hidden, 3 outputs:
  // obs -> hidden: 5 * 10 = 50
  // obs -> outputs: 5 * 3 = 15
  // hidden -> hidden: (10 * 9) / 2 = 45
  // hidden -> outputs: 10 * 3 = 30
  // Total: 50 + 15 + 45 + 30 = 140
  const result = mutator.calculateMaxSynapses(5, 10, 3);
  assertEquals(result, 140);
});

Deno.test("calculateMaxSynapses: single observation, single output, no hidden", () => {
  const mutator = createMutator();

  // With 1 observation, 0 hidden, 1 output:
  // obs -> outputs: 1 * 1 = 1
  // Total: 1
  const result = mutator.calculateMaxSynapses(1, 0, 1);
  assertEquals(result, 1);
});

Deno.test("calculateMaxSynapses: zero observations", () => {
  const mutator = createMutator();

  // With 0 observations, 3 hidden, 2 outputs:
  // obs -> hidden: 0 * 3 = 0
  // obs -> outputs: 0 * 2 = 0
  // hidden -> hidden: (3 * 2) / 2 = 3
  // hidden -> outputs: 3 * 2 = 6
  // Total: 0 + 0 + 3 + 6 = 9
  const result = mutator.calculateMaxSynapses(0, 3, 2);
  assertEquals(result, 9);
});

Deno.test("calculateMaxSynapses: large network", () => {
  const mutator = createMutator();

  // With 100 observations, 50 hidden, 10 outputs:
  // obs -> hidden: 100 * 50 = 5000
  // obs -> outputs: 100 * 10 = 1000
  // hidden -> hidden: (50 * 49) / 2 = 1225
  // hidden -> outputs: 50 * 10 = 500
  // Total: 5000 + 1000 + 1225 + 500 = 7725
  const result = mutator.calculateMaxSynapses(100, 50, 10);
  assertEquals(result, 7725);
});

Deno.test("calculateMaxSynapses: symmetric hidden layer", () => {
  const mutator = createMutator();

  // With 4 observations, 4 hidden, 4 outputs:
  // obs -> hidden: 4 * 4 = 16
  // obs -> outputs: 4 * 4 = 16
  // hidden -> hidden: (4 * 3) / 2 = 6
  // hidden -> outputs: 4 * 4 = 16
  // Total: 16 + 16 + 6 + 16 = 54
  const result = mutator.calculateMaxSynapses(4, 4, 4);
  assertEquals(result, 54);
});
