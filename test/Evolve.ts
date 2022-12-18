import { Network } from "../src/architecture/Network.ts";
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Mutation } from "../src/methods/mutation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("AND", async () => {
  // Train the AND gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = new Network(2, 1);

  const results = await network.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    log: 1,
    error: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("evolve-MT", async () => {
  // Train the AND gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = new Network(2, 1);

  const results = await network.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("evolve-XOR", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [1] },
    { input: [1, 0], output: [1] },
    { input: [1, 1], output: [0] },
  ];

  const network = new Network(2, 1);
  const results = await network.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
    iterations: 1000,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("x", () => {
  console.log("value", +false);
});

Deno.test("booleanXOR", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [1] },
    { input: [1, 0], output: [1] },
    { input: [1, 1], output: [0] },
  ];

  const network = new Network(2, 1);
  network.validate();
  const results = await network.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
  });

  network.validate();
  assert(results.error <= 0.03, "Error rate was: " + results.error);

  const value = network.activate([1, 0])[0];

  assert(value > 0.7, "Should be more than 0.7 was: " + value);
});

Deno.test("XNOR", async () => {
  // Train the XNOR gate
  const trainingSet = [
    { input: [0, 0], output: [1] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = new Network(2, 1);
  const results = await network.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("check", () => {
  assert(Number.isFinite(Infinity) == false);
});
