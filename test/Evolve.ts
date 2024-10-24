import { assert, fail } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";

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

  const network = new Creature(2, 1);

  const results = await network.evolveDataSet(trainingSet, {
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
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  const network = new Creature(2, 1);

  const results = await network.evolveDataSet(trainingSet, {
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
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [1] },
    { input: [1, 0], output: [1] },
    { input: [1, 1], output: [0] },
  ];

  let results = { error: 0 };
  for (let attempt = 0; attempt < 10; attempt++) {
    const network = new Creature(2, 1);
    results = await network.evolveDataSet(trainingSet, {
      mutation: Mutation.FFW,
      elitism: 10,
      mutationRate: 0.5,
      targetError: 0.03,
      threads: 1,
      iterations: 10_000,
    });

    if (results.error <= 0.03) break;
    console.info("Attempt", attempt, "failed with error", results.error);
  }

  assert(results.error <= 0.03, "Error rate was: " + results.error);
});

Deno.test("booleanXOR", async () => {
  // Train the XOR gate
  const trainingSet = [
    { input: [0, 0], output: [0] },
    { input: [0, 1], output: [1] },
    { input: [1, 0], output: [1] },
    { input: [1, 1], output: [0] },
  ];

  let network = new Creature(2, 1);
  let results = { error: 1 };
  for (let attempt = 0; attempt < 30; attempt++) {
    network.validate();
    results = await network.evolveDataSet(trainingSet, {
      mutation: Mutation.FFW,
      elitism: 10,
      mutationRate: 0.5,
      targetError: 0.025,
      threads: 1,
      iterations: 1000,
    });

    network.validate();
    if (results.error <= 0.03) break;
    network = new Creature(2, 1);
  }
  assert(results.error <= 0.03, "Error rate was: " + results.error);

  const value = network.activateAndTrace([1, 0])[0];

  assert(value > 0.65, "Should be more than 0.65 was: " + value);
});

Deno.test("XNOR - evolve", async () => {
  const trainingSet = [
    { input: [0, 0], output: [1] },
    { input: [0, 1], output: [0] },
    { input: [1, 0], output: [0] },
    { input: [1, 1], output: [1] },
  ];

  for (let attempt = 0; true; attempt++) {
    const creature = new Creature(2, 1);
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
