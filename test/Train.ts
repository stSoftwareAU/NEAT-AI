import { assert, fail } from "https://deno.land/std@0.211.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";
import { Creature } from "../src/Creature.ts";
import { train } from "../src/architecture/Training.ts";

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

  for (let attempts = 0; true; attempts++) {
    const network = new Creature(2, 1);

    const results = await train(network, trainingSet, {
      targetError: 0.1,
      iterations: 10_000,
      learningRate: 1,
      generations: 50,
      //       maximumBiasAdjustmentScale:0.1,
      //       maximumWeightAdjustmentScale: 0.1,
      // limitBiasScale:1,
      // limitWeightScale:1
    });

    if (results.error > 0.1 && attempts < 100) continue;

    assert(results.error <= 0.1, "Error rate was: " + results.error);
    break;
  }
});

Deno.test("MT", async () => {
  // Train the AND gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  for (let attempts = 0; true; attempts++) {
    const network = new Creature(2, 1, {
      layers: [
        { count: 5 },
      ],
    });

    const results = await train(network, trainingSet, {
      targetError: 0.03,
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

Deno.test("train-XOR", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [1] },
    { input: [1, 0], output: [1] },
    { input: [1, 1], output: [0] },
  ];
  const network = new Creature(2, 1, {
    layers: [
      { count: 5 },
    ],
  });
  const traceDir = ".trace";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `.trace/start.json`,
    JSON.stringify(network.internalJSON(), null, 2),
  );
  for (let attempts = 0; true; attempts++) {
    const results = await train(network, trainingSet, {
      targetError: 0.03,
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
Deno.test("XNOR", async () => {
  const trainingSet = [
    { input: [0, 0], output: [1] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  for (let attempts = 0; attempts < 12; attempts++) {
    const network = new Creature(2, 1, {
      layers: [
        { count: 5 },
      ],
    });

    const results = await train(network, trainingSet, {
      targetError: 0.03,
      iterations: 10_000,
    });

    if (results.error < 0.26) {
      break;
    }
    if (attempts > 10) {
      assert(results.error <= 0.03, "Error rate was: " + results.error);
    }
  }
});
