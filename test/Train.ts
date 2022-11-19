import { Network } from "../src/architecture/Network.ts";
import { assert } from "https://deno.land/std@0.165.0/testing/asserts.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

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

  const results = network.util.train(trainingSet, {
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

  const network = new Network(2, 1, {
    layers: [
      { count: 5 },
    ],
  });

  const results = network.util.train(trainingSet, {
    error: 0.03,
    iterations: 3000,
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
  const network = new Network(2, 1, {
    layers: [
      { count: 5 },
    ],
  });

  const results = network.util.train(trainingSet, {
    error: 0.03,
    iterations: 10000,
  });
  console.info(results);
  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

/**
 * Train the XNOR gate
 */
Deno.test("XNOR", () => {
  const trainingSet = [
    { input: [0, 0], output: [1] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  for (let attempts = 0; attempts < 12; attempts++) {
    const network = new Network(2, 1, {
      layers: [
        { count: 5 },
      ],
    });

    const results = network.util.train(trainingSet, {
      error: 0.03,
      iterations: 10_000,
    });

    console.info(results);
    if (results.error < 0.03) {
      break;
    }
    if (attempts > 10) {
      assert(results.error <= 0.03, "Error rate was: " + results.error);
    }
  }
});
