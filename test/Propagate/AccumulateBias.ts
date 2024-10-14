import { assertAlmostEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import {
  adjustedBias,
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { NeuronState } from "../../src/architecture/CreatureState.ts";

Deno.test("AccumulateBias-Standard", () => {
  const ns = new NeuronState();

  ns.accumulateBias(4, 2, 0);

  assertAlmostEquals(ns.totalBias, 2, 0.1, JSON.stringify(ns, null, 2));
});

Deno.test("AccumulateBias-Limited", () => {
  const ns = new NeuronState();

  ns.accumulateBias(40, 2, 0);

  const expected = 38;
  assertAlmostEquals(
    ns.totalBias,
    expected,
    0.1,
    `expected: ${expected}, totalBias: ${ns.totalBias}`,
  );
});

function makeCreature() {
  /*
   *  i0 i1 i2
   *  h3=(i0 * -0.1) + (i1 * 0.2) - 0.3
   *  o4=(h3 * 0.4) - 0.5
   *  o5=(h3 * -0.6) + (i2 * 0.7 ) + 0.8
   */
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "IDENTITY", bias: 0 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      /* h3=(i0 * -0.1) + (i1 * 0.2) - 0.3 */
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -1 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0 },

      /* o4=(h3 * 0.4) - 0.5*/
      { fromUUID: "hidden-3", toUUID: "output-0", weight: 1 },

      /* o5=(h3 * -0.6) + (i2 * 0.7 ) + 0.8*/
      { fromUUID: "hidden-3", toUUID: "output-1", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 1 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("AccumulateBias-average", () => {
  let config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const creature = makeCreature();
  const node = creature.neurons[3];

  const biases = [100, -0.1, 0, 0.2, -0.3, 4, -5, 60, -70];
  biases.forEach((bias) => {
    if (bias > 50) {
      config = createBackPropagationConfig({
        ...config,
        maximumBiasAdjustmentScale: 500,
      });
    }

    creature.clearState();
    const ns = node.creature.state.node(node.index);

    const values = [
      0.1,
      10,
      20,
      30,
      40,
      50,
      60,
      70,
      80,
      90,
      100,
      0.2,
      0.35,
      0.5,
      0.75,
      1,
      1.5,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      20,
      30,
      1,
      40,
      50,
      60,
      70,
      80,
      90,
      100,
      0.2,
      0.35,
      0.5,
      0.75,
      1,
      1.5,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      20,
      30,
      40,
      50,
      60,
      70,
      1.5,
      80,
      90,
      100,
      0.2,
      0.35,
      0.5,
      0.75,
      1,
      1.5,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      20,
      30,
      40,
      50,
      60,
      70,
      80,
      90,
      100,
      0.2,
      2,
      0.35,
      0.5,
      0.75,
      1,
      1.5,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      20,
      30,
      40,
      50,
      60,
      70,
      80,
      90,
      100,
      0.2,
      0.35,
      0.5,
      0.75,
    ];
    values.forEach((targetValue) => {
      const currentValue = targetValue - bias;
      ns.accumulateBias(targetValue, currentValue, 0);

      ns.accumulateBias(
        targetValue * -1,
        targetValue * -1 - bias,
        0,
      );
    });

    const aBias = adjustedBias(node, config);
    const tolerance = Math.abs(bias) > 50 ? 2 : Math.abs(bias) > 3 ? 0.5 : 0.01;
    assertAlmostEquals(
      aBias,
      bias,
      tolerance,
      `aBias: ${aBias}, bias: ${bias}, state: ${
        JSON.stringify(ns, null, 2)
      }, tolerance: ${tolerance}`,
    );
  });
});
