import { assertAlmostEquals } from "@std/assert";
import type { CreatureTrace } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { calculateBias } from "../../src/propagate/Bias.ts";
import { calculateWeight } from "../../src/propagate/Weight.ts";

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
          totalAdjustedBias: -2.54,
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
          count: 1,

          totalPositiveActivation: 2,
          totalNegativeActivation: 0,
          countNegativeActivations: 0,
          countPositiveActivations: 1,
          totalPositiveAdjustedValue: 0.2,
          totalNegativeAdjustedValue: 0,
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

  const config = createBackPropagationConfig({
    generations: 0,
    maximumBiasAdjustmentScale: 2,
    maximumWeightAdjustmentScale: 2,
    learningRate: 1,
  });
  const bias = calculateBias(
    outputNode,
    config,
  );

  assertAlmostEquals(bias, -1, 0.0001);

  const bias2 = calculateBias(
    outputNode,
    createBackPropagationConfig({
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

  const config = createBackPropagationConfig({
    generations: 0,
    maximumBiasAdjustmentScale: 5,
    maximumWeightAdjustmentScale: 5,
    learningRate: 1,
  });

  const cs = creature.state.connection(1, 3);

  const w1 = calculateWeight(
    cs,
    connection,
    config,
  );

  assertAlmostEquals(w1, 0.1, 0.2, `Weight: ${w1.toFixed(3)}`);

  const config2 = createBackPropagationConfig({
    generations: 10,
    maximumBiasAdjustmentScale: 2,
    maximumWeightAdjustmentScale: 2,
    learningRate: 1,
  });
  const w2 = calculateWeight(
    cs,
    connection,
    config2,
  );

  assertAlmostEquals(w2, 0.92, 0.1, `Weight: ${w2.toFixed(3)}`);
});
