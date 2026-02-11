import { assert, assertLess } from "@std/assert";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Creature } from "../../src/Creature.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #1379 - Integration test verifying that backward pass training
 * produces correct results when using pre-allocated reusable buffers.
 *
 * This test exercises the buffer pool through real multi-level propagation:
 * recursive propagate() calls acquire their own buffer sets from the pool.
 */
Deno.test("BackpropBuffers - multi-level training produces correct results", async () => {
  await initWasmForTests();

  // 3-input, 2-hidden, 1-output network with multi-level backward pass
  const creatureJson: CreatureInternal = {
    neurons: [
      { type: "hidden", index: 3, squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", index: 4, squash: "IDENTITY", bias: -0.1 },
      { type: "output", index: 5, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 1, to: 4, weight: 1 },
      { from: 2, to: 4, weight: 1 },
      { from: 3, to: 5, weight: 0.5 },
      { from: 4, to: 5, weight: -0.5 },
    ],
    input: 3,
    output: 1,
  };

  // Target function: 0.5*(i0+i1+0.1) - 0.5*(i1+i2-0.1)
  //                = 0.5*i0 - 0.5*i2 + 0.1
  const dataSet: DataRecordInterface[] = [
    {
      input: new Float32Array([1, 0, 0]),
      output: new Float32Array([0.6]),
    },
    {
      input: new Float32Array([0, 0, 1]),
      output: new Float32Array([-0.4]),
    },
    {
      input: new Float32Array([1, 1, 1]),
      output: new Float32Array([0.1]),
    },
    {
      input: new Float32Array([0.5, -0.5, 0.5]),
      output: new Float32Array([-0.15]),
    },
  ];

  // Perturb weights slightly so training has something to learn
  const json = Creature.fromJSON(creatureJson).exportJSON();
  for (const s of json.synapses) {
    s.weight += 0.02;
  }
  for (const n of json.neurons) {
    n.bias = (n.bias ?? 0) + 0.01;
  }

  const creature = Creature.fromJSON(json);
  creature.validate();

  const result = train(creature, dataSet, {
    iterations: 100,
    targetError: 0,
  });

  // Training should reduce error — backward pass with buffer reuse must
  // produce the same learning behaviour as fresh allocations.
  assertLess(result.error, 0.1, "Training should reduce error significantly");
});

Deno.test("BackpropBuffers - training with wider network exercises buffer reuse", async () => {
  await initWasmForTests();

  // Wider network: 4 inputs → 3 hidden → 2 outputs
  // This creates multiple inward connections per neuron, exercising
  // variable-length buffer acquisition.
  const creatureJson: CreatureInternal = {
    neurons: [
      { type: "hidden", index: 4, squash: "IDENTITY", bias: 0 },
      { type: "hidden", index: 5, squash: "IDENTITY", bias: 0 },
      { type: "hidden", index: 6, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 7, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 8, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, to: 4, weight: 1 },
      { from: 1, to: 4, weight: 0.5 },
      { from: 1, to: 5, weight: 1 },
      { from: 2, to: 5, weight: 0.5 },
      { from: 2, to: 6, weight: 1 },
      { from: 3, to: 6, weight: 0.5 },
      { from: 4, to: 7, weight: 1 },
      { from: 5, to: 7, weight: -1 },
      { from: 5, to: 8, weight: 1 },
      { from: 6, to: 8, weight: -1 },
    ],
    input: 4,
    output: 2,
  };

  const dataSet: DataRecordInterface[] = [];
  // Generate training data from the known network
  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  for (let i = 0; i < 8; i++) {
    const input = new Float32Array(4);
    for (let j = 0; j < 4; j++) {
      input[j] = Math.sin(i * 7 + j * 3) * 0.8;
    }
    const output = creature.activate(input);
    dataSet.push({ input, output: new Float32Array(output) });
  }

  // Perturb and retrain
  const json = creature.exportJSON();
  for (const s of json.synapses) {
    s.weight += 0.03;
  }
  for (const n of json.neurons) {
    n.bias = (n.bias ?? 0) + 0.02;
  }

  const perturbedCreature = Creature.fromJSON(json);
  perturbedCreature.validate();

  const result = train(perturbedCreature, dataSet, {
    iterations: 200,
    targetError: 0,
  });

  assertLess(result.error, 0.1, "Wider network training should converge");
});

Deno.test("BackpropBuffers - backpropBuffers field initialised on first propagate", async () => {
  await initWasmForTests();

  const creatureJson: CreatureInternal = {
    neurons: [
      { type: "hidden", index: 2, squash: "IDENTITY", bias: 0 },
      { type: "output", index: 3, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  // Before training, backpropBuffers should not be initialised
  assert(
    creature.state.backpropBuffers === undefined,
    "Buffers should not exist before training",
  );

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([1, 0]), output: new Float32Array([1.5]) },
  ];

  train(creature, dataSet, { iterations: 1, targetError: 0 });

  // After training, backpropBuffers should be initialised
  assert(
    creature.state.backpropBuffers !== undefined,
    "Buffers should exist after training",
  );
});
