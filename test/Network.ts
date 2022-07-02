import { Network } from "../src/architecture/network.js";
import { architect } from "../src/architecture/architect.js";
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.146.0/testing/asserts.ts";

import { Mutation } from "../src/methods/mutation.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";

/* Functions used in the testing process */
function checkMutation(method: unknown) {
  const network = architect.Perceptron(2, 4, 4, 4, 2);
  network.util.mutate(Mutation.ADD_GATE);
  network.util.mutate(Mutation.ADD_BACK_CONN);
  network.util.mutate(Mutation.ADD_SELF_CONN);

  const originalOutput = [];

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      originalOutput.push(network.activate([i / 10, j / 10]));
    }
  }

  network.util.mutate(method as { name: string });

  const mutatedOutput = [];

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      mutatedOutput.push(network.activate([i / 10, j / 10]));
    }
  }

  assertNotEquals(
    originalOutput,
    mutatedOutput,
    "Output of original network should be different from the mutated network!",
  );
}

async function evolveSet(set: any[], iterations: number, error: number) {
  const network = architect.Perceptron(
    set[0].input.length,
    5,
    set[0].output.length,
  );

  const options: NeatOptions = {
    iterations: iterations,
    error: error,
    threads: 1,
  };

  const results = await network.evolve(set, options);

  assert(results.error < error);
}

function trainSet(set: any[], iterations: number, error: number) {
  const network = architect.Perceptron(
    set[0].input.length,
    5,
    set[0].output.length,
  );

  const options: NeatOptions = {
    iterations: iterations,
    error: error,
    threads: 1,
  };

  const results = network.train(set, options);

  assert(results.error < error);
}

function testEquality(original: any, copied: any) {
  for (let j = 0; j < 50; j++) {
    const input = [];
    let a;
    for (a = 0; a < original.input; a++) {
      input.push(Math.random());
    }

    const ORout = original.activate(input);
    const COout = copied instanceof Network
      ? copied.activate(input)
      : copied(input);

    for (a = 0; a < original.output; a++) {
      ORout[a] = ORout[a].toFixed(9);
      COout[a] = COout[a].toFixed(9);
    }
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

Deno.test("ADD_GATE", () => {
  checkMutation(Mutation.ADD_GATE);
});

Deno.test("SUB_GATE", () => {
  checkMutation(Mutation.SUB_GATE);
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

Deno.test("Feed-forward", () => {
  const network1 = new Network(2, 2);
  const network2 = new Network(2, 2);

  // mutate it a couple of times
  let i;
  for (i = 0; i < 100; i++) {
    network1.util.mutate(Mutation.ADD_NODE);
    network2.util.mutate(Mutation.ADD_NODE);
  }
  for (i = 0; i < 400; i++) {
    network1.util.mutate(Mutation.ADD_CONN);
    network2.util.mutate(Mutation.ADD_NODE);
  }

  // Crossover
  const network = Network.crossOver(network1, network2);

  // Check if the network is feed-forward correctly
  for (i = 0; i < network.connections.length; i++) {
    const from = network.nodes.indexOf(network.connections[i].from);
    const to = network.nodes.indexOf(network.connections[i].to);

    // Exception will be made for memory connections soon
    assert(from < to, "network is not feeding forward correctly");
  }
});
Deno.test("from/toJSON equivalency", () => {
  let original, copy;
  original = architect.Perceptron(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);

  original = new Network(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);

  original = architect.LSTM(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);

  original = architect.GRU(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);

  original = architect.Random(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 10 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);

  original = architect.NARX(
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 10 + 1),
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
    Math.floor(Math.random() * 5 + 1),
  );
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);

  original = architect.Hopfield(Math.floor(Math.random() * 5 + 1));
  copy = Network.fromJSON(original.toJSON());
  testEquality(original, copy);
});
/* Deno.test("standalone equivalency", () => {
      let original;
      // let activate;
      original = architect.Perceptron(Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "activate"));

      original = new Network(Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "activate"));

      original = architect.LSTM(Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "activate"));

      original = architect.GRU(Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "activate"));

      original = architect.Random(Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 10 + 1), Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "return activate"));

      original = architect.NARX(Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1), Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "return activate"));

      original = architect.Hopfield(Math.floor(Math.random() * 5 + 1));
      eval(original.standalone());
      testEquality(original, eval( "return activate"));
  });*/

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
Deno.test("evolve XOR gate", async () => {
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
    3000,
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
    4000,
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
    4000,
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

  await evolveSet(set, 1000, 0.05);
});

// Deno.test("LSTM XOR", async () => {
//   const lstm = architect.LSTM(2, 1, 1);

//   await lstm.evolve([
//     { input: [0,0], output: [0] },
//     { input: [1,0], output: [1] },
//     { input: [1,1], output: [0] },
//     { input: [0,1], output: [1] },
//     { input: [0,1], output: [0] },
//   ], {
//     error: 0.001,
//     log: 100,
//     iterations: 5000,
//     rate: 0.3,
//   });

//   assert(0.9 < lstm.activate([1,0])[0], "LSTM error was: " +  lstm.activate([1])[0]);
//   assert(lstm.activate([1,1])[0] < 0.1, "LSTM error");
//   assert(0.9 <  lstm.activate([0,1])[0], "LSTM error");
//   assert( lstm.activate([0,0])[0] < 0.1, "LSTM error");
// });

// Deno.test("GRU XOR", () => {
//   const gru = architect.GRU(1, 2, 1);

//   gru.train([
//     { input: [0], output: [0] },
//     { input: [1], output: [1] },
//     { input: [1], output: [0] },
//     { input: [0], output: [1] },
//     { input: [0], output: [0] },
//   ], {
//     error: 0.001,
//     iterations: 5000,
//     rate: 0.1,
//     clear: true,
//   });

//   gru.activate([0]);

//   function getActivation(sensors: any) {
//     return gru.activate(sensors)[0];
//   }

//   assert(0.9 < getActivation([1]), "GRU error");
//   assert(getActivation([1]) < 0.1, "GRU error");
//   assert(0.9 < getActivation([0]), "GRU error");
//   assert(getActivation([0]) < 0.1, "GRU error");
// });

Deno.test("NARX Sequence", async () => {
  const narx = architect.NARX(1, 5, 1, 3, 3);

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

  const result = await narx.evolve(trainingData, {
    iterations: 5000,
    error: 0.005,
    rate: 0.05,
    threads: 1,
  });
  // const result = narx.test(trainingData);
  assert(result.error < 0.005, JSON.stringify(result, null, 2));
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

  await evolveSet(set, 1000, 0.05);
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

Deno.test("evolve SHIFT", async () => {
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
  const startJson = network.toJSON();
  const startTxt = JSON.stringify(startJson, null, 1);
  let fromTotalMS = 0;
  let toTotalMS = 0;
  let fromMinMS = Infinity;
  let toMinMS = Infinity;
  let currentJson = startJson;
  const LOOPS = 100;
  for (let i = LOOPS; i--;) {
    performance.mark("from-start");
    const currentNetwork = Network.fromJSON(currentJson);
    performance.mark("from-end");
    const fromMS = performance.measure("", "from-start", "from-end").duration;
    fromMinMS = fromMinMS > fromMS ? fromMS : fromMinMS;
    fromTotalMS += fromMS;

    performance.mark("to-start");
    currentJson = currentNetwork.toJSON();
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
  console.info("toJSON", toTotalMS / LOOPS, toMinMS);
  console.info("fromJSON", fromTotalMS / LOOPS, fromMinMS);
});
