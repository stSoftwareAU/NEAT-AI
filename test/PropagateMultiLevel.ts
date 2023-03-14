import { emptyDirSync } from "https://deno.land/std@0.177.0/fs/empty_dir.ts";
import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("propagateMultiLevel", () => {
  /*
   *  i0 i1 i2 i3 i4
   *  h5=i0 + i1 - 0.2
   *  h6=i3 + i4 - 0.1
   *  h7=i1 + i2 + i3 + 0.1
   *  h8=h6 + h7 + 0.2
   *  o9=(h8 * -0.5) + h5
   *  o10=(h8 * -0.4) + (h7 * 0.2) + 0.3
   */
  const creatureJsonA: NetworkInternal = {
    nodes: [
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
    connections: [
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
  const creatureA = Network.fromJSON(creatureJsonA);
  creatureA.validate();

  const ts = [];
  for (let i = 100; i--;) {
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

    const item = {
      input: [i0, i1, i2, i3, i4],
      output: [o9, o10],
    };

    ts.push(item);
  }

  ts.forEach((item) => {
    const result = creatureA.noTraceActivate(item.input);
    // console.info(item.input, item.output, result);
    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.internalJSON();

  const traceDir = ".trace";
  emptyDirSync(traceDir);
  Deno.writeTextFileSync(
    ".trace/start.json",
    JSON.stringify(internalJSON, null, 2),
  );

  internalJSON.nodes.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 == 0 ? 1 : -1) * 0.005);
  });

  internalJSON.connections.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.005);
  });

  Deno.writeTextFileSync(
    ".trace/changed.json",
    JSON.stringify(internalJSON, null, 2),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Network.fromJSON(internalJSON);
    creatureB.validate();

    const result1 = creatureB.train(ts, {
      iterations: 1,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/1.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    const result2 = creatureB.train(ts, {
      iterations: 100,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/100.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );
    console.info(result1.error, result2.error);
    if (attempts < 12) {
      if (result1.error <= result2.error) continue;
    }

    assert(result1.error > result2.error, `Didn't improve error`);

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 2),
    );

    creatureA.nodes.forEach((n, indx) => {
      const biasB = creatureB.nodes[indx].bias;
      assertAlmostEquals(n.bias ? n.bias : 0, biasB ? biasB : 0, 0.02);
    });

    creatureA.connections.forEach((c, indx) => {
      const weightA = c.weight;
      const weightB = creatureB.connections[indx].weight;
      assertAlmostEquals(weightA, weightB, 0.05);
    });

    break;
  }
});
