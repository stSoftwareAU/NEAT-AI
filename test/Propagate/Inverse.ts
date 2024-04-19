import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.223.0/fs/mod.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { train } from "../../src/architecture/Training.ts";
import { COMPLEMENT } from "../../src/methods/activations/types/COMPLEMENT.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  /*
   *  i0 i1 i2 i3 i4
   *  h5=i0 + i1 - 0.2
   *  h6=i3 + i4 - 0.1
   *  h7=i1 + i2 + i3 + 0.1
   *  h8=h6 + h7 + 0.2
   *  o9=(h8 * -0.5) + h5
   *  o10=(h8 * -0.4) + (h7 * 0.2) + 0.3
   */
  const creatureJsonA: CreatureInternal = {
    neurons: [
      { type: "hidden", index: 5, squash: "INVERSE", bias: -0.2 },
      { type: "hidden", index: 6, squash: "INVERSE", bias: -0.1 },
      { type: "hidden", index: 7, squash: "INVERSE", bias: 0.1 },

      { type: "hidden", index: 8, squash: "INVERSE", bias: 0.2 },

      {
        type: "output",
        squash: "INVERSE",
        index: 9,
        bias: 0,
      },
      {
        type: "output",
        squash: "INVERSE",
        index: 10,
        bias: 0.3,
      },
    ],
    synapses: [
      /* h5=i0 + i1 - 0.2 */
      { from: 0, to: 5, weight: 1 },
      { from: 1, to: 5, weight: 1 },

      /* h6=i3 + i4 - 0.1 */
      { from: 3, to: 6, weight: 1 },
      { from: 4, to: 6, weight: 1 },

      /* h7=i1 + i2 + i3 + 0.1 */
      { from: 1, to: 7, weight: 1 },
      { from: 2, to: 7, weight: 1 },
      { from: 3, to: 7, weight: 1 },

      /* h8=h6 + h7 + 0.2 */
      { from: 6, to: 8, weight: 1 },
      { from: 7, to: 8, weight: 1 },

      /* o9=(h8 * -0.5) + h5 */
      { from: 8, to: 9, weight: -0.5 },
      { from: 5, to: 9, weight: 1 },

      /* o10=(h8 * -0.4) + (h7 * 0.2) + 0.3 */
      { from: 8, to: 10, weight: -0.4 },
      { from: 7, to: 10, weight: 0.2 },
    ],
    input: 5,
    output: 2,
  };
  const creatureA = Creature.fromJSON(creatureJsonA);
  creatureA.validate();

  return creatureA;
}

Deno.test("propagateInverseRandom", async () => {
  const creatureA = makeCreature();
  const squash = new COMPLEMENT();
  const ts = [];
  for (let i = 10; i--;) {
    const i0 = Math.random() * 2 - 1;
    const i1 = Math.random() * 2 - 1;
    const i2 = Math.random() * 2 - 1;
    const i3 = Math.random() * 2 - 1;
    const i4 = Math.random() * 2 - 1;

    /* h5=i0 + i1 - 0.2 */
    const h5 = squash.squash(i0 + i1 - 0.2);

    /* h6=i3 + i4 - 0.1 */
    const h6 = squash.squash(i3 + i4 - 0.1);

    /* h7=i1 + i2 + i3 + 0.1 */
    const h7 = squash.squash(i1 + i2 + i3 + 0.1);

    /* h8=h6 + h7 + 0.2 */
    const h8 = squash.squash(h6 + h7 + 0.2);

    /* o9=(h8 * -0.5) + h5 */
    const o9 = squash.squash((h8 * -0.5) + h5);

    /* o10=(h8 * -0.4) + (h7 * 0.2) + 0.3 */
    const o10 = squash.squash((h8 * -0.4) + (h7 * 0.2) + 0.3);

    const item = {
      input: [i0, i1, i2, i3, i4],
      output: [o9, o10],
    };

    ts.push(item);
  }

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/data.json",
    JSON.stringify(ts, null, 2),
  );
  ts.forEach((item) => {
    const result = creatureA.activate(item.input);

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const exportJSON = creatureA.exportJSON();

  Deno.writeTextFileSync(
    ".trace/1-clean.json",
    JSON.stringify(exportJSON, null, 2),
  );

  exportJSON.neurons.forEach((node, indx) => {
    node.bias = node.bias +
      ((indx % 2 == 0 ? 1 : -1) * 0.005);
  });

  exportJSON.synapses.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.005);
  });

  Deno.writeTextFileSync(
    ".trace/2-modified.json",
    JSON.stringify(exportJSON, null, 2),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Creature.fromJSON(exportJSON);
    creatureB.validate();

    const result1 = await train(creatureB, ts, {
      iterations: 2,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/3-first.json",
      JSON.stringify(creatureB.exportJSON(), null, 2),
    );

    const result2 = await train(creatureB, ts, {
      iterations: 100,
      targetError: 0,
      traceStore: ".trace",
    });

    Deno.writeTextFileSync(
      ".trace/4-last.json",
      JSON.stringify(creatureB.exportJSON(), null, 2),
    );

    if (result1.error <= result2.error && attempts < 12) continue;

    assert(
      result1.error > result2.error,
      `Didn't improve error ${result1.error.toFixed(3)} -> ${
        result2.error.toFixed(3)
      }`,
    );

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 2),
    );

    creatureA.neurons.forEach((n, indx) => {
      const biasB = creatureB.neurons[indx].bias;
      assertAlmostEquals(n.bias, biasB, 0.05);
    });

    creatureA.synapses.forEach((c, indx) => {
      const weightA = c.weight;
      const weightB = creatureB.synapses[indx].weight;
      assertAlmostEquals(weightA, weightB, 1);
    });

    break;
  }
});
