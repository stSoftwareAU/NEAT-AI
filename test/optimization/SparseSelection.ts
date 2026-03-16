import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { train } from "../TrainTestOnlyUtil.ts";

Deno.test("optimization/SparseSelection - sparse training reduces error across different topologies", () => {
  // Two topologies: multi-path (two hidden neurons) and single-path (one hidden neuron).
  // Both should converge under sparse training with sparseRatio=0.5.
  const topologies = [
    {
      name: "multi-path",
      neurons: [
        { type: "input" as const, index: 0 },
        { type: "input" as const, index: 1 },
        { type: "hidden" as const, squash: "TANH", index: 2, bias: 0 },
        { type: "hidden" as const, squash: "TANH", index: 3, bias: 0 },
        { type: "output" as const, squash: "IDENTITY", index: 4, bias: 0 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5, type: "positive" as const },
        { from: 1, to: 3, weight: 0.5, type: "positive" as const },
        { from: 2, to: 4, weight: 0.5, type: "positive" as const },
        { from: 3, to: 4, weight: 0.5, type: "positive" as const },
      ],
      input: 2,
      output: 1,
    },
    {
      name: "single-path",
      neurons: [
        { type: "input" as const, index: 0 },
        { type: "input" as const, index: 1 },
        { type: "hidden" as const, squash: "TANH", index: 2, bias: 0 },
        { type: "output" as const, squash: "IDENTITY", index: 3, bias: 0 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 0.5, type: "positive" as const },
        { from: 1, to: 2, weight: 0.5, type: "positive" as const },
        { from: 2, to: 3, weight: 0.5, type: "positive" as const },
      ],
      input: 2,
      output: 1,
    },
  ];

  const trainingData = [
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  ];

  for (const topo of topologies) {
    const creature = Creature.fromJSON(topo);

    // Compute initial error before training
    let initialError = 0;
    for (const sample of trainingData) {
      const output = creature.activate(sample.input, false);
      initialError += (sample.output[0] - output[0]) ** 2;
    }
    initialError /= trainingData.length;

    const options: TrainOptions = {
      iterations: 5,
      sparseRatio: 0.5,
      targetError: 0.1,
    };

    const result = train(creature, trainingData, options);

    assert(
      Number.isFinite(result.error),
      `${topo.name}: error should be finite, got ${result.error}`,
    );
    assert(
      result.error < initialError,
      `${topo.name}: sparse training should reduce error: got ${result.error}, initial was ${initialError}`,
    );
  }
});
