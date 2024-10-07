import { assertAlmostEquals } from "@std/assert";
import {
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
} from "../../src/architecture/BackPropagation.ts";
import type { CreatureTrace } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const creatureJSON: CreatureTrace = {
    neurons: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
        trace: {
          count: 1,
          hintValue: -0.5,
          totalBias: -2.54,
          minimumActivation: 0,
          maximumActivation: 1,
        },
      },
    ],
    synapses: [
      {
        fromUUID: "input-1",
        toUUID: "output-0",
        weight: 1,
        trace: {
          averageWeight: 0.1,
          count: 1,
        },
      },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(creatureJSON);
  creature.validate();

  return creature;
}

Deno.test("Generation BIAS", () => {
  const creature = makeCreature();

  const outputNode = creature.neurons.find((node) => node.type === "output");

  if (!outputNode) {
    throw new Error("No output node found");
  }

  const config = new BackPropagationConfig({
    generations: 0,
    maximumBiasAdjustmentScale: 2,
    maximumWeightAdjustmentScale: 2,
    learningRate: 1,
  });
  const bias = adjustedBias(
    outputNode,
    config,
  );

  assertAlmostEquals(bias, -1, 0.0001);

  const bias2 = adjustedBias(
    outputNode,
    new BackPropagationConfig({
      generations: 1,
      maximumBiasAdjustmentScale: 2,
      maximumWeightAdjustmentScale: 2,
      learningRate: 1,
    }),
  );

  assertAlmostEquals(bias2, -0.77, 0.0001, `bias2: ${bias2.toFixed(3)}`);
});

Deno.test("Generation Weight", () => {
  const creature = makeCreature();

  const connection = creature.getSynapse(1, 3);

  if (!connection) {
    throw new Error("No connection found");
  }

  const w1 = adjustedWeight(
    creature.state,
    connection,
    new BackPropagationConfig({
      generations: 0,
      // useAverageWeight: "Yes",
      maximumBiasAdjustmentScale: 5,
      maximumWeightAdjustmentScale: 5,
      learningRate: 1,
    }),
  );

  assertAlmostEquals(w1, 0.1, 0.2, `Weight: ${w1.toFixed(3)}`);

  const config2 = new BackPropagationConfig({
    generations: 10,
    // useAverageWeight: "Yes",
    maximumBiasAdjustmentScale: 2,
    maximumWeightAdjustmentScale: 2,
    learningRate: 1,
  });
  const w2 = adjustedWeight(
    creature.state,
    connection,
    config2,
  );

  assertAlmostEquals(w2, 0.92, 0.1, `Weight: ${w2.toFixed(3)}`);
});
