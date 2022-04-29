import { Network } from "../src/architecture/network.js";
import { architect } from "../src/architecture/architect.js";
import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";
import { assert } from "https://deno.land/std@0.137.0/testing/asserts.ts";

// Compact form: name and function
Deno.test("AND", () => {
  // Train the AND gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = new Network(2, 1);
  const util = new NetworkUtil(network);

  const results = util.train(trainingSet, {
    error: 0.03,
    iterations: 1000,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("MT", () => {
  // Train the AND gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = architect.Perceptron(2, 5, 1);
  const util = new NetworkUtil(network);

  const results = util.train(trainingSet, {
    error: 0.03,
    iterations: 1000,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});
Deno.test("train-XOR", () => {
  // Train the XOR gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [1] },
    { input: [1, 0], output: [1] },
    { input: [1, 1], output: [0] },
  ];

  const network = architect.Perceptron(2, 5, 1);
  const util = new NetworkUtil(network);

  const results = util.train(trainingSet, {
    error: 0.03,
    iterations: 1000,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("XNOR", () => {
  // Train the XNOR gate
  const trainingSet = [
    { input: [0, 0], output: [1] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = architect.Perceptron(2, 5, 1);
  const util = new NetworkUtil(network);

  const results = util.train(trainingSet, {
    error: 0.03,
    iterations: 1000,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});
