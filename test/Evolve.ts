import { assert, fail } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

// Compact form: name and function
Deno.test("AND", async () => {
  // Train the AND gate
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  const results = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    log: 1,
    targetError: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("evolve-MT", async () => {
  // Train the AND gate
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);

  const results = await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    elitism: 10,
    mutationRate: 0.5,
    targetError: 0.03,
    threads: 1,
  });

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("XOR-evolve", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  let bestError = Number.POSITIVE_INFINITY;
  let results = { error: 0 };
  for (let attempt = 0; attempt < 100; attempt++) {
    const creature = new Creature(2, 1);
    // deno-lint-ignore no-await-in-loop
    results = await creature.evolveDataSet(trainingSet, {
      iterations: 10_000,
      targetError: 0.03,
    });

    if (results.error < bestError) {
      bestError = results.error;
    }
    if (results.error <= 0.03) break;
  }

  assert(
    results.error <= 0.03,
    "Error rate was: " + results.error + " best:" + bestError,
  );
});

Deno.test("booleanXOR", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  let creature = new Creature(2, 1);
  let results = { error: 1 };
  for (let attempt = 0; attempt < 300; attempt++) {
    // deno-lint-ignore no-await-in-loop
    results = await creature.evolveDataSet(trainingSet, {
      mutation: Mutation.FFW,
      elitism: 10,
      mutationRate: 0.5,
      targetError: 0.025,
      // threads: 1,
      iterations: 1000,
    });

    if (results.error <= 0.04) break;
    creature = new Creature(2, 1);
  }
  assert(results.error <= 0.04, "Error rate was: " + results.error);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );
  const value =
    creature.activateAndTrace(new Float32Array([1, 0]), false, sparseConfig)[0];

  assert(value > 0.65, "Should be more than 0.65 was: " + value);
});

Deno.test("XNOR - evolve", async () => {
  await Deno.mkdir(".discovery", { recursive: true });
  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  for (let attempt = 0; true; attempt++) {
    const creature = new Creature(2, 1);
    // deno-lint-ignore no-await-in-loop
    const results = await creature.evolveDataSet(trainingSet, {
      targetError: 0.05,
      iterations: 20_000,
      enableRepetitiveTraining: true,
    });

    if (results.error > 0.05) {
      if (attempt < 24) {
        console.info(`attempt: ${attempt}`, results);
        continue;
      } else {
        fail(`Error rate was: ${results.error}`);
      }
    }
    break;
  }
});
