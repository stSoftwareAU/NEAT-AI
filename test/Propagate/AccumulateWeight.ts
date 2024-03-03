import { assertAlmostEquals } from "https://deno.land/std@0.218.0/assert/assert_almost_equals.ts";
import { accumulateWeight } from "../../src/architecture/BackPropagation.ts";
import { SynapseState } from "../../src/architecture/CreatureState.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Creature, CreatureExport } from "../../mod.ts";
import { adjustedWeight } from "../../src/architecture/BackPropagation.ts";

Deno.test("AccumulateWeight-Standard", () => {
  const cs = new SynapseState();
  cs.averageWeight = 1;
  cs.count = 1;
  const config = new BackPropagationConfig();
  accumulateWeight(1, cs, 4, 2, config);

  assertAlmostEquals(cs.averageWeight, 1.5, 0.1, JSON.stringify(cs, null, 2));
});

Deno.test("AccumulateWeight-Limited", () => {
  const config = new BackPropagationConfig();
  config.maximumWeightAdjustmentScale = 5;
  const cs = new SynapseState();
  cs.averageWeight = 3;
  cs.count = 1;

  accumulateWeight(0, cs, 40, 2, config);

  const unlimitedExpected = (3 + (40 / 2)) / 2;
  const expected = (3 + 5) / 2;
  assertAlmostEquals(
    cs.averageWeight,
    expected,
    0.1,
    `Unlimited: ${unlimitedExpected} expected: ${expected}, average: ${cs.averageWeight}`,
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

Deno.test("AccumulateWeight-average", () => {
  const config = new BackPropagationConfig({ generations: 0, learningRate: 1 });

  const creature = makeCreature();
  const node = creature.neurons[3];
  const synapse = creature.getSynapse(0, node.index);

  if (!synapse) throw new Error("synapse not found");

  const weights = [100, -0.1, 0, 0.2, -0.3, 4, -5, 60, -70];
  weights.forEach((weight) => {
    if (weight > 50) {
      config.maximumWeightAdjustmentScale = 500;
    }

    creature.clearState();
    const ss = node.creature.state.connection(0, node.index);

    const activations = [
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
    activations.forEach((activation) => {
      accumulateWeight(1, ss, activation * weight, activation, config);
      accumulateWeight(
        1,
        ss,
        activation * weight * -1,
        activation * -1,
        config,
      );
    });

    const aWeight = adjustedWeight(creature.state, synapse, config);
    const tolerance = Math.abs(weight) > 50
      ? 2
      : Math.abs(weight) > 3
      ? 0.5
      : 0.01;
    assertAlmostEquals(
      aWeight,
      weight,
      tolerance,
      `aWeight: ${aWeight}, weight: ${weight}, state: ${
        JSON.stringify(ss, null, 2)
      }, tolerance: ${tolerance}`,
    );
  });
});
