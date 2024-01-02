import { emptyDirSync } from "https://deno.land/std@0.210.0/fs/empty_dir.ts";
import { Network } from "../src/architecture/Network.ts";
import { assert, fail } from "https://deno.land/std@0.210.0/assert/mod.ts";

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

  for (let attempts = 0; true; attempts++) {
    const network = new Network(2, 1);

    const results = network.train(trainingSet, {
      error: 0.03,
      iterations: 1_000,
    });

    if (results.error > 0.03 && attempts < 12) continue;
    console.info(results);
    assert(results.error <= 0.03, "Error rate was: " + results.error);
    break;
  }
});

Deno.test("MT", () => {
  // Train the AND gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  for (let attempts = 0; true; attempts++) {
    const network = new Network(2, 1, {
      layers: [
        { count: 5 },
      ],
    });

    const results = network.train(trainingSet, {
      error: 0.03,
      iterations: 10000,
    });

    if (results.error <= 0.26) break;
    if (attempts > 12) {
      fail(`Error rate was ${results.error}`);
    } else {
      console.warn(`Warning rate was ${results.error}`);
    }
  }
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
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    `.trace/start.json`,
    JSON.stringify(network.internalJSON(), null, 2),
  );
  for (let attempts = 0; true; attempts++) {
    const results = network.train(trainingSet, {
      error: 0.03,
      iterations: 10000,
    });
    Deno.writeTextFileSync(
      `.trace/${attempts}.json`,
      JSON.stringify(results.trace, null, 2),
    );

    if (results.error <= 0.26) {
      break;
    }

    if (attempts > 12) {
      throw "Error rate was: " + results.error;
    }
  }
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

    const results = network.train(trainingSet, {
      error: 0.03,
      iterations: 10_000,
    });

    console.info(results);
    if (results.error < 0.26) {
      break;
    }
    if (attempts > 10) {
      assert(results.error <= 0.03, "Error rate was: " + results.error);
    }
  }
});
