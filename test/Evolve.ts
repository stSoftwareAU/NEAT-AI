import { Network } from "../src/architecture/network.js";
import { assert } from "https://deno.land/std@0.146.0/testing/asserts.ts";
import { Mutation } from "../src/methods/mutation.ts";

declare global {
  interface Window {
    DEBUG: boolean;
  }
}

window.DEBUG = true;

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

  const results = await network.evolve(trainingSet, {
    mutation: Mutation.FFW,
    equal: true,
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

  const results = await network.evolve(trainingSet, {
    mutation: Mutation.FFW,
    equal: true,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 2,
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
  const results = await network.evolve(trainingSet, {
    mutation: Mutation.FFW,
    equal: true,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("x", () => {
  console.log("value", +false);
});

Deno.test("booleanXOR", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: [false, false], output: [0] },
    { input: [false, true], output: [1] },
    { input: [true, false], output: [1] },
    { input: [true, true], output: [0] },
  ];

  const network = new Network(2, 1);
  network.util.validate();
  const results = await network.evolve(trainingSet, {
    mutation: Mutation.FFW,
    equal: true,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
  });

  network.util.validate();
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
  const results = await network.evolve(trainingSet, {
    mutation: Mutation.FFW,
    equal: true,
    elitism: 10,
    mutationRate: 0.5,
    error: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});
Deno.test("check", () => {
  assert(isFinite(Infinity) == false);
});
