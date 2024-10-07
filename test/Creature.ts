import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  fail,
} from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { addTag, getTag } from "@stsoftware/tags";
import { Creature } from "../src/Creature.ts";
import type { DataRecordInterface } from "../src/architecture/DataSet.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import { train } from "../src/architecture/Training.ts";
import type { NeatOptions } from "../src/config/NeatOptions.ts";
import type { TrainOptions } from "../src/config/TrainOptions.ts";
import { Mutation } from "../src/NEAT/Mutation.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/* Functions used in the testing process */
function checkMutation(method: { name: string }) {
  const network = new Creature(2, 2, {
    layers: [
      { count: 4 },
      { count: 4 },
      { count: 4 },
    ],
  });

  network.mutate(Mutation.ADD_BACK_CONN);
  network.mutate(Mutation.ADD_SELF_CONN);

  const originalOutput = [];

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const v = network.activateAndTrace([i / 10, j / 10], true);
      originalOutput.push(...v);
    }
  }

  const json1 = JSON.stringify(network.exportJSON(), null, 2);
  for (let i = 10; i--;) {
    network.mutate(method);
  }
  const json2 = JSON.stringify(network.exportJSON(), null, 2);

  assertNotEquals(json1, json2);

  const mutatedOutput = [];

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const v = network.activateAndTrace([i / 10, j / 10], true);
      mutatedOutput.push(...v);
    }
  }

  assertNotEquals(
    originalOutput,
    mutatedOutput,
    "Output of original network should be different from the mutated network!",
  );
}

async function evolveSet(
  set: DataRecordInterface[],
  iterations: number,
  error: number,
  attempts = 1,
) {
  const options: NeatOptions = {
    iterations: iterations,
    targetError: error,
    threads: 1,
  };

  let resultError = Number.MAX_VALUE;
  let lastCreature: Creature | null = null;
  for (let attempt = attempts; attempt--;) {
    lastCreature = new Creature(set[0].input.length, set[0].output.length, {
      layers: [
        { count: 5 },
      ],
    });
    const results = await lastCreature.evolveDataSet(set, options);
    resultError = results.error;
    if (resultError <= error) {
      break;
    }
    console.info(
      `Error is: ${results.error}, required: ${error} RETRY ${attempt} of ${attempts}`,
    );
  }
  assert(resultError <= error, `expected: ${error}, was: ${resultError}`);
  assert(lastCreature instanceof Creature, "Last creature is not a creature");

  set.forEach((dr) => {
    const nt0 = lastCreature.activate(dr.input)[0];

    const nt1 = lastCreature.activate(dr.input)[0];
    creatureValidate(lastCreature);

    if (Math.abs(nt0 - nt1) > 0.0001) {
      Deno.writeTextFileSync(
        ".start.json",
        JSON.stringify(lastCreature.exportJSON(), null, 2),
      );
      const nt2 = lastCreature.activate(dr.input)[0];

      Deno.writeTextFileSync(
        ".end.json",
        JSON.stringify(lastCreature.exportJSON(), null, 2),
      );

      const n0 = Creature.fromJSON(lastCreature.exportJSON()).activate(
        dr.input,
      )[0];

      lastCreature.clearCache();
      const c1 = lastCreature.activate(dr.input)[0];
      const n1 = Creature.fromJSON(lastCreature.exportJSON()).activate(
        dr.input,
      )[0];
      const network2 = Creature.fromJSON(lastCreature.exportJSON());
      const n2 = network2.activate(dr.input)[0];
      const n2b = network2.activate(dr.input)[0];
      assertAlmostEquals(
        nt0,
        nt1,
        0.000_1,
        "noTraceActivate first: " + nt0 + ", second: " +
          nt1 + ", third: " + nt2 + ", new0: " + n0 + ", new1: " + n1 +
          ", new2: " + n2 + ", new2b: " + n2b + ", cleared cache: " + c1,
      );
    }

    const r0 = lastCreature.activateAndTrace(dr.input)[0];
    const r1 = lastCreature.activateAndTrace(dr.input)[0];
    assertAlmostEquals(
      r0,
      r1,
      0.000_1,
      "activate first: " + r0 + ", second: " +
        r1,
    );

    const r2 = lastCreature.activate(dr.input)[0];

    assertAlmostEquals(
      r1,
      r2,
      0.000_1,
      "Mismatch activate: " + r1 + ", no trace: " +
        r2,
    );
  });

  return lastCreature;
}

function trainSet(
  set: { input: number[]; output: number[] }[],
  iterations: number,
  error: number,
) {
  const traceDir = ".trace";
  ensureDirSync(traceDir);

  for (let attempts = 0; true; attempts++) {
    const network = new Creature(
      set[0].input.length,
      set[0].output.length,
      {
        layers: [
          {
            count: 5,
          },
        ],
      },
    );

    const options: TrainOptions = {
      iterations: iterations,
      targetError: error,
    };

    const results = train(network, set, options);
    Deno.writeTextFileSync(
      `.trace/${attempts}.json`,
      JSON.stringify(results.trace, null, 2),
    );
    if (results.error >= error && attempts < 12) {
      console.info(`Error is: ${results.error}, required: ${error} RETRY`);
      continue;
    }
    assert(
      results.error < error,
      `Error is: ${results.error}, required: ${error}`,
    );

    set.forEach((dr) => {
      const r1 = network.activateAndTrace(dr.input)[0];
      const r2 = network.activate(dr.input)[0];

      assertAlmostEquals(
        r1,
        r2,
        0.000_1,
        "Mismatch activate: " + r1.toLocaleString("en-AU") + ", no trace: " +
          r2.toLocaleString("en-AU"),
      );
    });

    break;
  }
}

function testEquality(original: Creature, copied: Creature) {
  for (let j = 0; j < 50; j++) {
    const input = [];
    let a;
    for (a = 0; a < original.input; a++) {
      input.push(Math.random());
    }

    const ORout = original.activateAndTrace(input);
    const COout = copied.activateAndTrace(input);

    // for (a = 0; a < original.output; a++) {
    //   ORout[a] = ORout[a].toFixed(9);
    //   COout[a] = COout[a].toFixed(9);
    // }
    assertEquals(
      ORout,
      COout,
      copied instanceof Creature
        ? "Original and JSON copied networks are not the same!"
        : "Original and standalone networks are not the same!",
    );
  }
}

/*******************************************************************************************
                          Test the performance of networks
*******************************************************************************************/
Deno.test("ADD_NODE", () => {
  checkMutation(Mutation.ADD_NODE);
});

Deno.test("ADD_CONNECTION", () => {
  checkMutation(Mutation.ADD_CONN);
});

Deno.test("MOD_BIAS", () => {
  checkMutation(Mutation.MOD_BIAS);
});

Deno.test("MOD_WEIGHT", () => {
  checkMutation(Mutation.MOD_WEIGHT);
});

Deno.test("SUB_CONN", () => {
  checkMutation(Mutation.SUB_CONN);
});

Deno.test("SUB_NODE", () => {
  checkMutation(Mutation.SUB_NODE);
});

Deno.test("MOD_ACTIVATION", () => {
  checkMutation(Mutation.MOD_ACTIVATION);
});

Deno.test("ADD_SELF_CONN", () => {
  checkMutation(Mutation.ADD_SELF_CONN);
});

Deno.test("SUB_SELF_CONN", () => {
  checkMutation(Mutation.SUB_SELF_CONN);
});

Deno.test("ADD_BACK_CONN", () => {
  checkMutation(Mutation.ADD_BACK_CONN);
});

Deno.test("SUB_BACK_CONN", () => {
  checkMutation(Mutation.SUB_BACK_CONN);
});

Deno.test("SWAP_NODES", () => {
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

    assert(gender == "male" || gender == "female", "No gender: " + gender);
  }
});

Deno.test("Feed-forward", () => {
  const network1 = new Creature(2, 2);
  const network2 = new Creature(2, 2);

  // mutate it a couple of times
  let i;
  for (i = 0; i < 100; i++) {
    network1.mutate(Mutation.ADD_NODE);
    network2.mutate(Mutation.ADD_NODE);
  }
  for (i = 0; i < 400; i++) {
    network1.mutate(Mutation.ADD_CONN);
    network2.mutate(Mutation.ADD_NODE);
  }

  // Crossover
  const child = Offspring.breed(network1, network2);

  if (child) {
    // Check if the network is feed-forward correctly
    for (i = 0; i < child.synapses.length; i++) {
      const from = child.synapses[i].from;
      const to = child.synapses[i].to;

      // Exception will be made for memory connections soon
      assert(from <= to, "network is not feeding forward correctly");
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

Deno.test("train_AND_gate", () => {
  trainSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [0] },
      { input: [1, 0], output: [0] },
      { input: [1, 1], output: [1] },
    ],
    1000,
    0.26,
  );
});

Deno.test("evolve_AND_gate", async () => {
  await evolveSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [0] },
      { input: [1, 0], output: [0] },
      { input: [1, 1], output: [1] },
    ],
    10000,
    0.002,
  );
});

Deno.test("evolve XORgate", async () => {
  const creature = await evolveSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [1] },
      { input: [1, 0], output: [1] },
      { input: [1, 1], output: [0] },
    ],
    1_000,
    0.05,
    100,
  );
  const evolveDir = ".evolve";
  ensureDirSync(evolveDir);
  Deno.writeTextFileSync(
    ".evolve/XOR.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );
});

Deno.test("train XOR gate", () => {
  trainSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [1] },
      { input: [1, 0], output: [1] },
      { input: [1, 1], output: [0] },
    ],
    100000,
    0.26,
  );
});

Deno.test("evolve_NOT_gate", async () => {
  await evolveSet(
    [
      { input: [0], output: [1] },
      { input: [1], output: [0] },
    ],
    1000,
    0.002,
  );
});

Deno.test("train_NOT_gate", () => {
  trainSet(
    [
      { input: [0], output: [1] },
      { input: [1], output: [0] },
    ],
    1000,
    0.26,
  );
});

Deno.test("evolve_XNOR_gate", async () => {
  await evolveSet(
    [
      { input: [0, 0], output: [1] },
      { input: [0, 1], output: [0] },
      { input: [1, 0], output: [0] },
      { input: [1, 1], output: [1] },
    ],
    1_000,
    0.002,
    100,
  );
});

Deno.test("train_XNOR_gate", () => {
  trainSet(
    [
      { input: [0, 0], output: [1] },
      { input: [0, 1], output: [0] },
      { input: [1, 0], output: [0] },
      { input: [1, 1], output: [1] },
    ],
    100000,
    0.26,
  );
});

Deno.test("train OR gate", () => {
  trainSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [1] },
      { input: [1, 0], output: [1] },
      { input: [1, 1], output: [1] },
    ],
    1000,
    0.26,
  );
});

Deno.test("evolve OR gate", async () => {
  await evolveSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [1] },
      { input: [1, 0], output: [1] },
      { input: [1, 1], output: [1] },
    ],
    1000,
    0.002,
  );
});

Deno.test("train_SIN_function", () => {
  const set = [];

  while (set.length < 100) {
    const inputValue = Math.random() * Math.PI * 2;
    set.push({
      input: [inputValue / (Math.PI * 2)],
      output: [(Math.sin(inputValue) + 1) / 2],
    });
  }

  trainSet(set, 10_000, 0.16);
});

Deno.test("evolve_SIN_function", async () => {
  const set = [];

  while (set.length < 100) {
    const inputValue = Math.random() * Math.PI * 2;
    set.push({
      input: [inputValue / (Math.PI * 2)],
      output: [(Math.sin(inputValue) + 1) / 2],
    });
  }

  await evolveSet(set, 10000, 0.06);
});

Deno.test("train_Bigger_than", () => {
  const set = [];

  for (let i = 0; i < 100; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = x > y ? 1 : 0;

    set.push({ input: [x, y], output: [z] });
  }

  trainSet(set, 500, 0.26);
});

Deno.test("evolve_Bigger_than", async () => {
  const set = [];

  for (let i = 0; i < 100; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = x > y ? 1 : 0;

    set.push({ input: [x, y], output: [z] });
  }

  await evolveSet(set, 10000, 0.08);
});

Deno.test("NARX Sequence", async () => {
  // Train the XOR gate (in sequence!)
  const trainingData = [
    { input: [0], output: [0] },
    { input: [0], output: [0] },
    { input: [0], output: [1] },
    { input: [1], output: [0] },
    { input: [0], output: [0] },
    { input: [0], output: [0] },
    { input: [0], output: [1] },
  ];

  const maxAttempts = 24;
  for (let attempts = 0; true; attempts++) {
    const creature = new Creature(1, 1, {
      layers: [
        { count: 5 },
      ],
    });

    const result = await creature.evolveDataSet(trainingData, {
      iterations: 5000,
      targetError: 0.005,
      // threads: 1,
      feedbackLoop: true,
    });

    if (result.error < 0.005) break;
    console.info(
      `Error is: ${result.error}, required: ${0.005} RETRY ${
        attempts + 1
      } of ${maxAttempts}`,
    );
    if (attempts > maxAttempts) {
      fail(JSON.stringify(result, null, 2));
    }
  }
});

Deno.test("train SIN + COS", () => {
  const set = [];

  while (set.length < 100) {
    const inputValue = Math.random() * Math.PI * 2;
    set.push({
      input: [inputValue / (Math.PI * 2)],
      output: [
        (Math.sin(inputValue) + 1) / 2,
        (Math.cos(inputValue) + 1) / 2,
      ],
    });
  }

  trainSet(set, 1000, 0.13);
});

Deno.test("evolve SIN + COS", async () => {
  const set = [];

  while (set.length < 100) {
    const inputValue = Math.random() * Math.PI * 2;
    set.push({
      input: [inputValue / (Math.PI * 2)],
      output: [
        (Math.sin(inputValue) + 1) / 2,
        (Math.cos(inputValue) + 1) / 2,
      ],
    });
  }

  await evolveSet(set, 10_000, 0.08);
});

Deno.test("train_SHIFT", () => {
  const set = [];

  for (let i = 0; i < 1000; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();

    set.push({ input: [x, y, z], output: [z, x, y] });
  }

  trainSet(set, 500, 0.1);
});

Deno.test("evolveSHIFT", async () => {
  const set = [];

  for (let i = 0; i < 1000; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();

    set.push({ input: [x, y, z], output: [z, x, y] });
  }

  const creature = await evolveSet(set, 5000, 0.03);
  const evolveDir = ".evolve";
  ensureDirSync(evolveDir);
  Deno.writeTextFileSync(
    ".evolve/SHIFT.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );
});

Deno.test("from-to", () => {
  const network = new Creature(1000, 10);
  const startJson = network.exportJSON();
  const startTxt = JSON.stringify(startJson, null, 1);
  let fromTotalMS = 0;
  let toTotalMS = 0;
  let fromMinMS = Infinity;
  let toMinMS = Infinity;
  let currentJson = startJson;
  const LOOPS = 100;

  ((globalThis as unknown) as { DEBUG: boolean }).DEBUG = false;
  for (let i = LOOPS; i--;) {
    performance.mark("from-start");
    const currentNetwork = Creature.fromJSON(currentJson);
    performance.mark("from-end");
    const fromMS = performance.measure("", "from-start", "from-end").duration;
    fromMinMS = fromMinMS > fromMS ? fromMS : fromMinMS;
    fromTotalMS += fromMS;

    performance.mark("to-start");
    currentJson = currentNetwork.exportJSON();
    performance.mark("to-end");
    const toMS = performance.measure("", "to-start", "to-end").duration;
    toMinMS = toMinMS > toMS ? toMS : toMinMS;
    toTotalMS += toMS;
    const currentTxt = JSON.stringify(currentJson, null, 1);

    if (startTxt != currentTxt) {
      Deno.writeTextFileSync(
        ".start.json",
        startTxt,
      );
      Deno.writeTextFileSync(
        ".end.json",
        currentTxt,
      );

      assert(false, "JSON changed");
    }
  }
  ((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;
  console.info("toJSON", toTotalMS / LOOPS, toMinMS);
  console.info("fromJSON", fromTotalMS / LOOPS, fromMinMS);
});
