import { assert, assertEquals, fail } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Stable seed per mutation name so parallel full-suite runs do not exhaust RNG state. */
function rngSeedForMutationTest(methodName: string): number {
  let h = 2166136261;
  for (let i = 0; i < methodName.length; i++) {
    h ^= methodName.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Functions used in the testing process */
function checkMutation(method: { name: string }) {
  const rngBefore = getRandomNumberGenerator();
  setRandomNumberGenerator(
    createSeededRng(rngSeedForMutationTest(method.name)),
  );
  try {
    checkMutationBody(method);
  } finally {
    setRandomNumberGenerator(rngBefore);
  }
}

function checkMutationBody(method: { name: string }) {
  const memoryMutation = method.name === Mutation.ADD_BACK_CONN.name ||
    method.name === Mutation.SUB_BACK_CONN.name ||
    method.name === Mutation.ADD_SELF_CONN.name ||
    method.name === Mutation.SUB_SELF_CONN.name;
  const creature = new Creature(2, 2, {
    layers: [
      { count: 4 },
      { count: 4 },
      { count: 4 },
    ],
    ...(memoryMutation ? { feedbackEnabled: true } : {}),
  });
  creatureValidate(creature);
  const mutator = new Mutator(createNeatConfig({
    // Forward-only is the default. Enable feedbackLoop only when testing memory mutations.
    feedbackLoop: memoryMutation ? true : false,
  }));
  for (let i = 12; i--;) {
    if (mutator.mutateCreature(creature, method)) break;
  }
  for (let i = 6; i--;) {
    mutator.mutateCreature(creature, Mutation.ADD_BACK_CONN);
  }
  for (let i = 6; i--;) {
    mutator.mutateCreature(creature, Mutation.ADD_SELF_CONN);
  }
  // Issue #1583: mutateCreature() no longer calls fix() internally.
  // Repair the creature before validating to ensure structural invariants
  // (e.g. IF neurons having all required connection types) are restored.
  mutator.repairAfterMutation(creature);
  creatureValidate(creature);
  const originalOutput = [];
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const v = creature.activateAndTrace(
        new Float32Array([i / 10, j / 10]),
        true,
        sparseConfig,
      );
      originalOutput.push(...v);
    }
  }

  const json1 = JSON.stringify(creature.exportJSON(), null, 1);
  for (let i = 12; i--;) {
    if (mutator.mutateCreature(creature, method)) break;
  }
  mutator.repairAfterMutation(creature);
  const json2 = JSON.stringify(creature.exportJSON(), null, 1);

  if (json1 === json2) {
    Deno.writeTextFileSync(
      ".test/clean.json",
      JSON.stringify(JSON.parse(json1), null, 1),
    );
    Deno.writeTextFileSync(
      ".test/mutated.json",
      JSON.stringify(JSON.parse(json2), null, 1),
    );
    fail(
      "JSON of original creature is the same as the mutated creature!",
    );
  }

  const mutatedOutput = [];

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const v = creature.activateAndTrace(
        new Float32Array([i / 10, j / 10]),
        true,
        sparseConfig,
      );
      mutatedOutput.push(...v);
    }
  }

  if (originalOutput.toString() === mutatedOutput.toString()) {
    console.warn(
      "Output of original creature is the same as the mutated creature!",
    );
    Deno.writeTextFileSync(
      ".clean.json",
      JSON.stringify(JSON.parse(json1), null, 1),
    );
    Deno.writeTextFileSync(
      ".mutated.json",
      JSON.stringify(JSON.parse(json2), null, 1),
    );
    console.warn(
      `${method.name} failed: Output of original creature is the same as the mutated creature!`,
    );
  }
}

function testEquality(original: Creature, copied: Creature) {
  const sparseConfig = new SparseConfig(
    original.exportJSON(),
    createBackPropagationConfig({}),
  );

  for (let j = 0; j < 50; j++) {
    const input = [];
    let a;
    for (a = 0; a < original.input; a++) {
      input.push(Math.random());
    }

    const ORout = original.activateAndTrace(
      new Float32Array(input),
      false,
      sparseConfig,
    );
    const COout = copied.activateAndTrace(
      new Float32Array(input),
      false,
      sparseConfig,
    );

    assertEquals(
      ORout,
      COout,
      copied instanceof Creature
        ? "Original and JSON copied creatures are not the same!"
        : "Original and standalone creatures are not the same!",
    );
  }
}

/*******************************************************************************************
                          Test the performance of creatures
*******************************************************************************************/
Deno.test("ADD_NODE", async () => {
  await initWasmForTests();
  checkMutation(Mutation.ADD_NODE);
});

Deno.test("ADD_CONNECTION", async () => {
  await initWasmForTests();
  checkMutation(Mutation.ADD_CONN);
});

Deno.test("MOD_BIAS", async () => {
  await initWasmForTests();
  checkMutation(Mutation.MOD_BIAS);
});

Deno.test("MOD_WEIGHT", async () => {
  await initWasmForTests();
  checkMutation(Mutation.MOD_WEIGHT);
});

Deno.test("SUB_CONN", async () => {
  await initWasmForTests();
  checkMutation(Mutation.SUB_CONN);
});

Deno.test("SUB_NODE", async () => {
  await initWasmForTests();
  checkMutation(Mutation.SUB_NODE);
});

Deno.test("MOD_SQUASH", async () => {
  await initWasmForTests();
  checkMutation(Mutation.MOD_SQUASH);
});

Deno.test("ADD_SELF_CONN", async () => {
  await initWasmForTests();
  checkMutation(Mutation.ADD_SELF_CONN);
});

Deno.test("SUB_BACK_CONN", async () => {
  await initWasmForTests();
  checkMutation(Mutation.SUB_BACK_CONN);
});

Deno.test("ADD_BACK_CONN", async () => {
  await initWasmForTests();
  checkMutation(Mutation.ADD_BACK_CONN);
});

Deno.test("SUB_SELF_CONN", async () => {
  await initWasmForTests();
  checkMutation(Mutation.SUB_SELF_CONN);
});

Deno.test("SWAP_NODES", async () => {
  await initWasmForTests();
  checkMutation(Mutation.SWAP_NODES);
});

Deno.test("gender-tag", () => {
  const mum = new Creature(2, 2);
  const dad = new Creature(2, 2);

  addTag(mum.neurons[3], "gender", "male");

  addTag(dad.neurons[3], "gender", "female");

  // Crossover
  const child = Offspring.breed(mum, dad);

  if (child) {
    const gender = getTag(child.neurons[3], "gender");

    assert(gender === "male" || gender === "female", "No gender: " + gender);
  }
});

Deno.test("Feed-forward", () => {
  const creature1 = new Creature(2, 2);
  const creature2 = new Creature(2, 2);
  const mutator = new Mutator(createNeatConfig({}));
  // mutate it a couple of times
  let i;
  for (i = 0; i < 100; i++) {
    mutator.mutateCreature(creature1, Mutation.ADD_NODE);
    mutator.mutateCreature(creature2, Mutation.ADD_NODE);
  }
  for (i = 0; i < 400; i++) {
    mutator.mutateCreature(creature1, Mutation.ADD_CONN);
    mutator.mutateCreature(creature2, Mutation.ADD_NODE);
  }

  // Crossover
  const child = Offspring.breed(creature1, creature2);

  if (child) {
    child.validate();
    // Check if the creature is feed-forward correctly
    for (i = 0; i < child.synapses.length; i++) {
      const from = child.synapses[i].from;
      const to = child.synapses[i].to;

      // Exception will be made for memory connections soon
      assert(from <= to, "creature is not feeding forward correctly");
    }
  }
});

Deno.test("from/toJSON equivalency", () => {
  let original, copy;
  original = new Creature(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    {
      layers: [
        { count: Math.floor(Math.random() * 5 + 1) },
      ],
    },
  );

  copy = Creature.fromJSON(original.exportJSON());
  testEquality(original, copy);

  original = new Creature(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Creature.fromJSON(original.exportJSON());
  testEquality(original, copy);

  original = new Creature(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    {
      layers: [
        { count: Math.floor(Math.random() * 10 + 1) },
      ],
    },
  );

  copy = Creature.fromJSON(original.exportJSON());
  testEquality(original, copy);
});
