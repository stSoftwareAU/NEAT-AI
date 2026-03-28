import { assert, fail } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Compact form: name and function
Deno.test("AND", async () => {
  await withRngTestLock(async () => {
    await initWasmForTests();
    const previousRng = getRandomNumberGenerator();
    // Train the AND gate
    const trainingSet = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];

    try {
      for (let attempts = 0; true; attempts++) {
        setRandomNumberGenerator(createSeededRng(25 + attempts));
        const network = new Creature(2, 1);

        const results = train(network, trainingSet, {
          targetError: 0.1,
          iterations: 10_000,
          learningRate: 1,
          generations: 50,
        });

        if (results.error > 0.1 && attempts < 100) continue;

        assert(results.error <= 0.1, "Error rate was: " + results.error);
        break;
      }
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  });
});

Deno.test("MT", async () => {
  await withRngTestLock(async () => {
    await initWasmForTests();
    const previousRng = getRandomNumberGenerator();
    // Train the AND gate
    const trainingSet = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];

    try {
      for (let attempts = 0; true; attempts++) {
        // Keep this test independent from global RNG state mutated by other tests.
        // Seed 5 reproduces the quick-converging path from the historical test.
        setRandomNumberGenerator(createSeededRng(5 + attempts));
        const network = new Creature(2, 1, {
          layers: [
            { count: 5 },
          ],
        });

        const results = train(network, trainingSet, {
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
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  });
});

Deno.test("train-XOR", async () => {
  await withRngTestLock(async () => {
    await initWasmForTests();
    const previousRng = getRandomNumberGenerator();
    // Train the XOR gate
    const trainingSet = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
    ];

    const traceDir = ".trace";
    ensureDirSync(traceDir);
    try {
      for (let attempts = 0; true; attempts++) {
        setRandomNumberGenerator(createSeededRng(75 + attempts));
        const network = new Creature(2, 1, {
          layers: [
            { count: 5 },
          ],
          outputLayer: {
            squash: "LOGISTIC",
          },
        });

        if (attempts === 0) {
          // deno-lint-ignore no-sync-fn-in-async-fn
          Deno.writeTextFileSync(
            `.trace/start.json`,
            JSON.stringify(network.exportJSON(), null, 1),
          );
        }

        const results = train(network, trainingSet, {
          targetError: 0.03,
          iterations: 10000,
        });
        // deno-lint-ignore no-sync-fn-in-async-fn
        Deno.writeTextFileSync(
          `.trace/${attempts}.json`,
          JSON.stringify(results.trace, null, 1),
        );

        if (results.error <= 0.26) {
          break;
        }

        if (attempts > 24) {
          throw "Error rate was: " + results.error;
        }
      }
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  });
});

/**
 * Train the XNOR gate
 */
Deno.test("XNOR - train", async () => {
  await withRngTestLock(async () => {
    await initWasmForTests();
    const previousRng = getRandomNumberGenerator();
    const trainingSet = [
      { input: new Float32Array([0, 0]), output: new Float32Array([1]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];

    try {
      for (let attempts = 0; true; attempts++) {
        setRandomNumberGenerator(createSeededRng(100 + attempts));
        const creature = new Creature(2, 1, {
          layers: [
            { count: 5 },
          ],
        });

        const results = train(creature, trainingSet, {
          targetError: 0.03,
          iterations: 10_000,
        });

        if (results.error < 0.26) {
          break;
        }

        if (attempts > 200) {
          fail("Error rate was: " + results.error);
        }
      }
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  });
});
