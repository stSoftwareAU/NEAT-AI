import {
  assertAlmostEquals,
} from "https://deno.land/std@0.211.0/assert/mod.ts";
import {
  adjustedBias,
  adjustedWeight,
  BackPropagationConfig,
} from "../../src/architecture/BackPropagation.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkTrace } from "../../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const creatureJSON: NetworkTrace = {
    nodes: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
        trace: {
          count: 1,
          totalValue: -2.54,
          totalWeightedSum: -2.54,
        },
      },
    ],
    connections: [
      {
        fromUUID: "input-1",
        toUUID: "output-0",
        weight: 1,
        trace: {
          totalValue: -2.54,
          totalActivation: -0.8,
          count: 1,
          absoluteActivation: 0.8,
        },
      },
    ],
    input: 3,
    output: 1,
  };
  const creature = Network.fromJSON(creatureJSON);
  creature.validate();

  return creature;
}

Deno.test("Generation BIAS", () => {
  const creature = makeCreature();

  const outputNode = creature.nodes.find((node) => node.type === "output");

  if (!outputNode) {
    throw new Error("No output node found");
  }

  const bias = adjustedBias(
    outputNode,
    new BackPropagationConfig({ generations: 0 }),
  );

  assertAlmostEquals(bias, 0, 0.0001);

  const bias2 = adjustedBias(
    outputNode,
    new BackPropagationConfig({
      generations: 1,
      useAverageDifferenceBias: "Yes",
    }),
  );

  assertAlmostEquals(bias2, 0.5, 0.0001, `bias2: ${bias2.toFixed(3)}`);
});

Deno.test("Generation Weight", () => {
  const creature = makeCreature();

  const connection = creature.getConnection(1, 3);

  if (!connection) {
    throw new Error("No connection found");
  }

  const w1 = adjustedWeight(
    creature.networkState,
    connection,
    new BackPropagationConfig({
      generations: 0,
      useAverageValuePerActivation: "Yes",
    }),
  );

  assertAlmostEquals(w1, 3.2, 0.1, `Weight: ${w1.toFixed(3)}`);

  const w2 = adjustedWeight(
    creature.networkState,
    connection,
    new BackPropagationConfig({
      generations: 10,
      useAverageValuePerActivation: "Yes",
    }),
  );

  assertAlmostEquals(w2, 0.8, 0.1, `Weight: ${w2.toFixed(3)}`);
});
