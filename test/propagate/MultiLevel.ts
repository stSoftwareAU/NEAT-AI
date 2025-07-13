import { assert, assertAlmostEquals } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { train } from "../TrainTestOnlyUtil.ts";

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
      { type: "hidden", index: 5, squash: "IDENTITY", bias: -0.2 },
      { type: "hidden", index: 6, squash: "IDENTITY", bias: -0.1 },
      { type: "hidden", index: 7, squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", index: 8, squash: "IDENTITY", bias: 0.2 },

      {
        type: "output",
        squash: "IDENTITY",
        index: 9,
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
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

Deno.test("propagateMultiLevelRandom", () => {
  const creatureA = makeCreature();

  const ts: DataRecordInterface[] = [];
  for (let i = 10; i--;) {
    const i0 = Math.random() * 2 - 1;
    const i1 = Math.random() * 2 - 1;
    const i2 = Math.random() * 2 - 1;
    const i3 = Math.random() * 2 - 1;
    const i4 = Math.random() * 2 - 1;

    /* h5=i0 + i1 - 0.2 */
    const h5 = i0 + i1 - 0.2;

    /* h6=i3 + i4 - 0.1 */
    const h6 = i3 + i4 - 0.1;

    /* h7=i1 + i2 + i3 + 0.1 */
    const h7 = i1 + i2 + i3 + 0.1;

    /* h8=h6 + h7 + 0.2 */
    const h8 = h6 + h7 + 0.2;

    /* o9=(h8 * -0.5) + h5 */
    const o9 = (h8 * -0.5) + h5;

    /* o10=(h8 * -0.4) + (h7 * 0.2) + 0.3 */
    const o10 = (h8 * -0.4) + (h7 * 0.2) + 0.3;

    const item: DataRecordInterface = {
      input: new Float32Array([i0, i1, i2, i3, i4]),
      output: new Float32Array([o9, o10]),
    };

    ts.push(item);
  }

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/data.json",
    JSON.stringify(ts, null, 1),
  );
  ts.forEach((item) => {
    const result = creatureA.activate(new Float32Array(item.input));

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.exportJSON();

  Deno.writeTextFileSync(
    ".trace/1-clean.json",
    JSON.stringify(internalJSON, null, 1),
  );

  internalJSON.neurons.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 === 0 ? 1 : -1) * 0.005);
  });

  internalJSON.synapses.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 === 0 ? 1 : -1) * 0.005);
  });

  Deno.writeTextFileSync(
    ".trace/2-modified.json",
    JSON.stringify(internalJSON, null, 1),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Creature.fromJSON(internalJSON);
    creatureB.validate();

    const result1 = train(creatureB, ts, {
      iterations: 2,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/3-first.json",
      JSON.stringify(creatureB.exportJSON(), null, 1),
    );

    const result2 = train(creatureB, ts, {
      iterations: 100,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/4-last.json",
      JSON.stringify(creatureB.exportJSON(), null, 1),
    );

    if (result2.error < 0.0001) break;
    if (attempts < 12) {
      if (result1.error <= result2.error) continue;
    }

    assert(result1.error >= result2.error, `Didn't improve error`);

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 1),
    );

    break;
  }
});

Deno.test("propagateMultiLevelKnownA", () => {
  const creatureA = makeCreature();

  const ts: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  ts.forEach((item) => {
    const result = creatureA.activate(new Float32Array(item.input));

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.exportJSON();

  Deno.writeTextFileSync(
    ".trace/1-clean.json",
    JSON.stringify(internalJSON, null, 1),
  );

  internalJSON.neurons.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 === 0 ? 1 : -1) * 0.005);
  });

  internalJSON.synapses.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 === 0 ? 1 : -1) * 0.005);
  });

  Deno.writeTextFileSync(
    ".trace/2-modified.json",
    JSON.stringify(internalJSON, null, 1),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Creature.fromJSON(internalJSON);
    creatureB.validate();

    const result1 = train(creatureB, ts, {
      iterations: 2,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/3-first.json",
      JSON.stringify(creatureB.exportJSON(), null, 1),
    );

    const result2 = train(creatureB, ts, {
      iterations: 10000,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/4-last.json",
      JSON.stringify(creatureB.exportJSON(), null, 1),
    );

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 1),
    );

    if (attempts < 12) {
      if (result1.error < result2.error) continue;
    }

    assert(result1.error >= result2.error, `Didn't improve error`);

    break;
  }
});

Deno.test("propagateMultiLevelKnownB", () => {
  const creatureA = makeCreature();

  const ts: DataRecordInterface[] = [
    {
      input: new Float32Array([0, 0]),
      output: new Float32Array([0]),
    },
    {
      input: new Float32Array([0, 1]),
      output: new Float32Array([1]),
    },
    {
      input: new Float32Array([1, 0]),
      output: new Float32Array([1]),
    },
    {
      input: new Float32Array([1, 1]),
      output: new Float32Array([0]),
    },
  ];

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  ts.forEach((item) => {
    const result = creatureA.activate(new Float32Array(item.input));

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.exportJSON();

  Deno.writeTextFileSync(
    ".trace/start.json",
    JSON.stringify(internalJSON, null, 1),
  );

  internalJSON.neurons.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 === 0 ? 1 : -1) * 0.005);
  });

  internalJSON.synapses.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 === 0 ? 1 : -1) * 0.005);
  });

  Deno.writeTextFileSync(
    ".trace/changed.json",
    JSON.stringify(internalJSON, null, 1),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Creature.fromJSON(internalJSON);
    creatureB.validate();

    const result1 = train(creatureB, ts, {
      iterations: 2,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/first.json",
      JSON.stringify(creatureB.exportJSON(), null, 1),
    );

    const result2 = train(creatureB, ts, {
      iterations: 100,
      targetError: 0,
    });

    Deno.writeTextFileSync(
      ".trace/last.json",
      JSON.stringify(creatureB.exportJSON(), null, 1),
    );

    if (result2.error < 0.0001) break;
    if (attempts < 12) {
      if (result1.error <= result2.error) continue;
    }

    assert(result1.error >= result2.error, `Didn't improve error`);

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 1),
    );

    break;
  }
});
