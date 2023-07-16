import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.194.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

import { emptyDirSync } from "https://deno.land/std@0.194.0/fs/empty_dir.ts";
import { DataRecordInterface } from "../src/architecture/DataSet.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";
import { TrainOptions } from "../src/config/TrainOptions.ts";
import { Mutation } from "../src/methods/mutation.ts";
import { addTag, getTag } from "../src/tags/TagsInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/* Functions used in the testing process */
function checkMutation(method: { name: string }) {
  const network = new Network(2, 2, {
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
      const v = network.activate([i / 10, j / 10], true);
      originalOutput.push(...v);
    }
  }

  const json1 = JSON.stringify(network.exportJSON(), null, 2);
  for (let i = 10; i--;) {
    network.mutate(method);
  }
  const json2 = JSON.stringify(network.exportJSON(), null, 2);

  console.info(json1);
  console.info(json2);
  assertNotEquals(json1, json2);

  const mutatedOutput = [];

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const v = network.activate([i / 10, j / 10], true);
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
) {
  const network = new Network(set[0].input.length, set[0].output.length, {
    layers: [
      { count: 5 },
    ],
  });
  const options: NeatOptions = {
    iterations: iterations,
    error: error,
    threads: 1,
  };

  const results = await network.evolveDataSet(set, options);

  assert(results.error <= error, `expected: ${error}, was: ${results.error}`);

  set.forEach((dr) => {
    const nt0 = network.noTraceActivate(dr.input)[0];

    const nt1 = network.noTraceActivate(dr.input)[0];
    network.validate();

    if (Math.abs(nt0 - nt1) > 0.0001) {
      Deno.writeTextFileSync(
        ".start.json",
        JSON.stringify(network.exportJSON(), null, 2),
      );
      const nt2 = network.noTraceActivate(dr.input)[0];

      Deno.writeTextFileSync(
        ".end.json",
        JSON.stringify(network.exportJSON(), null, 2),
      );
      console.log(dr.input);
      const n0 = Network.fromJSON(network.exportJSON()).noTraceActivate(
        dr.input,
      )[0];

      network.clearCache();
      const c1 = network.noTraceActivate(dr.input)[0];
      const n1 = Network.fromJSON(network.exportJSON()).noTraceActivate(
        dr.input,
      )[0];
      const network2 = Network.fromJSON(network.exportJSON());
      const n2 = network2.noTraceActivate(dr.input)[0];
      const n2b = network2.noTraceActivate(dr.input)[0];
      assertAlmostEquals(
        nt0,
        nt1,
        0.000_1,
        "noTraceActivate first: " + nt0 + ", second: " +
          nt1 + ", third: " + nt2 + ", new0: " + n0 + ", new1: " + n1 +
          ", new2: " + n2 + ", new2b: " + n2b + ", cleared cache: " + c1,
      );
    }

    const r0 = network.activate(dr.input)[0];
    const r1 = network.activate(dr.input)[0];
    assertAlmostEquals(
      r0,
      r1,
      0.000_1,
      "activate first: " + r0 + ", second: " +
        r1,
    );

    const r2 = network.noTraceActivate(dr.input)[0];

    if (Math.abs(r1 - r2) > 0.0001) {
      console.log("hello");
      const r3 = network.activate(dr.input)[0];
      console.log(r2, r3);
      console.info(JSON.stringify(network.exportJSON(), null, 2));
    }
    assertAlmostEquals(
      r1,
      r2,
      0.000_1,
      "Mismatch activate: " + r1 + ", no trace: " +
        r2,
    );
  });
}

function trainSet(
  set: { input: number[]; output: number[] }[],
  iterations: number,
  error: number,
) {
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  for (let attempts = 0; true; attempts++) {
    const network = new Network(
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
      error: error,
    };

    const results = network.train(set, options);
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
      const r1 = network.activate(dr.input)[0];
      const r2 = network.noTraceActivate(dr.input)[0];

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

function testEquality(original: Network, copied: Network) {
  for (let j = 0; j < 50; j++) {
    const input = [];
    let a;
    for (a = 0; a < original.input; a++) {
      input.push(Math.random());
    }

    const ORout = original.activate(input);
    const COout = copied.activate(input);

    // for (a = 0; a < original.output; a++) {
    //   ORout[a] = ORout[a].toFixed(9);
    //   COout[a] = COout[a].toFixed(9);
    // }
    assertEquals(
      ORout,
      COout,
      copied instanceof Network
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
  const network1 = new Network(2, 2);
  const network2 = new Network(2, 2);

  addTag(network1.nodes[0], "gender", "male");

  addTag(network2.nodes[0], "gender", "female");

  // Crossover
  const network = Offspring.bread(network1, network2);

  const gender = getTag(network.nodes[0], "gender");

  assert(gender == "male" || gender == "female", "No gender: " + gender);
});

Deno.test("Feed-forward", () => {
  const network1 = new Network(2, 2);
  const network2 = new Network(2, 2);

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
  const network = Offspring.bread(network1, network2);

  // Check if the network is feed-forward correctly
  for (i = 0; i < network.connections.length; i++) {
    const from = network.connections[i].from;
    const to = network.connections[i].to;

    // Exception will be made for memory connections soon
    assert(from <= to, "network is not feeding forward correctly");
  }
});

Deno.test("from/toJSON equivalency", () => {
  let original, copy;
  original = new Network(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    {
      layers: [
        { count: Math.floor(Math.random() * 5 + 1) },
      ],
    },
  );

  copy = Network.fromJSON(original.exportJSON());
  testEquality(original, copy);

  original = new Network(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.exportJSON());
  testEquality(original, copy);

  original = new Network(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    {
      layers: [
        { count: Math.floor(Math.random() * 10 + 1) },
      ],
    },
  );

  copy = Network.fromJSON(original.exportJSON());
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
    0.002,
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
    1000,
    0.002,
  );
});

Deno.test("evolve XORgate", async () => {
  await evolveSet(
    [
      { input: [0, 0], output: [0] },
      { input: [0, 1], output: [1] },
      { input: [1, 0], output: [1] },
      { input: [1, 1], output: [0] },
    ],
    3000,
    0.002,
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
    0.002,
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
    0.002,
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
    10000,
    0.002,
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
    0.002,
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
    0.002,
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

  trainSet(set, 1000, 0.05);
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

  await evolveSet(set, 1000, 0.05);
});

Deno.test("train_Bigger_than", () => {
  const set = [];

  for (let i = 0; i < 100; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = x > y ? 1 : 0;

    set.push({ input: [x, y], output: [z] });
  }

  trainSet(set, 500, 0.05);
});

Deno.test("evolve_Bigger_than", async () => {
  const set = [];

  for (let i = 0; i < 100; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = x > y ? 1 : 0;

    set.push({ input: [x, y], output: [z] });
  }

  await evolveSet(set, 10000, 0.05);
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

  for (let attempts = 0; true; attempts++) {
    const narx = new Network(1, 1, {
      layers: [
        { count: 5 },
      ],
    });

    const result = await narx.evolveDataSet(trainingData, {
      iterations: 5000,
      error: 0.005,
      threads: 1,
      feedbackLoop: true,
    });
    if (attempts < 12) {
      if (result.error < 0.005) break;
    } else {
      assert(result.error < 0.005, JSON.stringify(result, null, 2));
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

  trainSet(set, 1000, 0.05);
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

  await evolveSet(set, 10_000, 0.05);
});

Deno.test("train_SHIFT", () => {
  const set = [];

  for (let i = 0; i < 1000; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();

    set.push({ input: [x, y, z], output: [z, x, y] });
  }

  trainSet(set, 500, 0.03);
});

Deno.test("evolveSHIFT", async () => {
  const set = [];

  for (let i = 0; i < 1000; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();

    set.push({ input: [x, y, z], output: [z, x, y] });
  }

  await evolveSet(set, 500, 0.03);
});

Deno.test("from-to", () => {
  const network = new Network(1000, 10);
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
    const currentNetwork = Network.fromJSON(currentJson);
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
