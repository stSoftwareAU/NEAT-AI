import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.211.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkInternal } from "../../src/architecture/NetworkInterfaces.ts";

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

  return creatureA;
}

Deno.test("propagateMultiLevelRandom", async () => {
  const creatureA = makeCreature();

  const ts = [];
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
    const result = creatureA.noTraceActivate(item.input);

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.internalJSON();

  Deno.writeTextFileSync(
    ".trace/1-clean.json",
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
    ".trace/2-modified.json",
    JSON.stringify(internalJSON, null, 2),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Network.fromJSON(internalJSON);
    creatureB.validate();

    const result1 = await creatureB.train(ts, {
      iterations: 2,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/3-first.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    const result2 = await creatureB.train(ts, {
      iterations: 100,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/4-last.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    if (result2.error < 0.0001) break;
    if (attempts < 12) {
      if (result1.error <= result2.error) continue;
    }

    assert(result1.error >= result2.error, `Didn't improve error`);

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 2),
    );

    // creatureA.nodes.forEach((n, indx) => {
    //   const biasB = creatureB.nodes[indx].bias;
    //   assertAlmostEquals(n.bias ? n.bias : 0, biasB ? biasB : 0, 0.3);
    // });

    // creatureA.connections.forEach((c, indx) => {
    //   const weightA = c.weight;
    //   const weightB = creatureB.connections[indx].weight;
    //   assertAlmostEquals(weightA, weightB, 0.2);
    // });

    break;
  }
});

Deno.test("propagateMultiLevelKnownA", async () => {
  const creatureA = makeCreature();

  const ts = [
    {
      input: [
        -0.27531950876712274,
        0.5479420077758608,
        -0.31874732875566325,
        -0.3251023819212233,
        0.15454329791943922,
      ],
      output: [
        0.10585589246014296,
        0.3274051741809188,
      ],
    },
    {
      input: [
        -0.3612056780276385,
        0.9096105605219611,
        -0.8659227597409149,
        0.44677862195782003,
        -0.09670308649191028,
      ],
      output: [
        -0.17186609660806534,
        0.0018765012658628621,
      ],
    },
    {
      input: [
        -0.17874511732331655,
        -0.7496947696932943,
        0.959481645159241,
        0.8684967066537888,
        0.4269570441542858,
      ],
      output: [
        -2.415308553480516,
        -0.49383821674717693,
      ],
    },
    {
      input: [
        -0.4447006894324379,
        -0.572776847410577,
        0.4927513139898987,
        -0.45849471080496373,
        0.0009604639980089758,
      ],
      output: [
        -0.8194502913267164,
        0.5307177475679103,
      ],
    },
    {
      input: [
        0.49420868796430417,
        -0.9655944749457044,
        -0.7580421810363256,
        0.7275242279304446,
        0.3545993403680803,
      ],
      output: [
        -0.8143913571048699,
        0.006373058290907119,
      ],
    },
    {
      input: [
        -0.9667719712127556,
        -0.12489250942412777,
        -0.6163353274150167,
        -0.5395475664106004,
        0.8922808113191314,
      ],
      output: [
        -0.9276434014662764,
        0.35506178268653654,
      ],
    },
    {
      input: [
        0.18994911069785259,
        -0.06908795488532649,
        0.970015305390477,
        0.9995843069171326,
        -0.8828565951931608,
      ],
      output: [
        -1.1877585287606014,
        -0.18679341617404543,
      ],
    },
    {
      input: [
        0.5487347163158076,
        0.5540220869303343,
        -0.5593642660532745,
        0.9256198489683127,
        0.6505482470137651,
      ],
      output: [
        -0.44546607966758334,
        -0.5745227723619057,
      ],
    },
    {
      input: [
        0.7589201369401768,
        0.32152953303957377,
        0.915559229624789,
        0.4984483456788058,
        -0.14709659680383957,
      ],
      output: [
        -0.26299475862931687,
        -0.2476481212186203,
      ],
    },
    {
      input: [
        0.31885182318586747,
        0.019578285028655884,
        -0.7782299013804974,
        -0.3870857203699787,
        0.9993950556856181,
      ],
      output: [
        0.3051441089176137,
        0.2242237332181082,
      ],
    },
  ];

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  ts.forEach((item) => {
    const result = creatureA.noTraceActivate(item.input);

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.internalJSON();

  Deno.writeTextFileSync(
    ".trace/1-clean.json",
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
    ".trace/2-modified.json",
    JSON.stringify(internalJSON, null, 2),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Network.fromJSON(internalJSON);
    creatureB.validate();

    const result1 = await creatureB.train(ts, {
      iterations: 2,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/3-first.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    const result2 = await creatureB.train(ts, {
      iterations: 10000,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/4-last.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 2),
    );

    if (attempts < 12) {
      if (result1.error < result2.error) continue;
    }

    assert(result1.error >= result2.error, `Didn't improve error`);

    // creatureA.nodes.forEach((n, indx) => {
    //   const biasB = creatureB.nodes[indx].bias;
    //   assertAlmostEquals(n.bias ? n.bias : 0, biasB ? biasB : 0, 0.05);
    // });

    // creatureA.connections.forEach((c, indx) => {
    //   const weightA = c.weight;
    //   const weightB = creatureB.connections[indx].weight;
    //   assertAlmostEquals(weightA, weightB, 0.2);
    // });

    break;
  }
});

Deno.test("propagateMultiLevelKnownB", async () => {
  const creatureA = makeCreature();

  const ts = [
    {
      input: [
        0.5248507257495652,
        -0.28543795867942023,
        0.18740369346093644,
        -0.6605677828448306,
        -0.3171284385959967,
      ],
      output: [
        0.8075619018222158,
        0.7827988981889938,
      ],
    },
    {
      input: [
        0.2789549526574393,
        -0.22349486526080398,
        0.260399432405082,
        0.9286351696851609,
        0.07764455533894798,
      ],
      output: [
        -1.2304496435301386,
        -0.35561983737553143,
      ],
    },
    {
      input: [
        -0.40368981334134446,
        -0.213621943214799,
        -0.5802850450754495,
        -0.857427772895456,
        -0.8274206653515948,
      ],
      output: [
        0.7507798431602342,
        1.2442063275359614,
      ],
    },
    {
      input: [
        0.21272674116508172,
        0.3048272525535327,
        -0.04234498118472896,
        -0.7953801680107304,
        0.02447840899777365,
      ],
      output: [
        0.8694538215460561,
        0.654940282933568,
      ],
    },
    {
      input: [
        0.8073204739663722,
        0.7272228536959955,
        -0.08970491701819583,
        0.0074725536602415765,
        -0.9851503469154008,
      ],
      output: [
        1.4008869791209269,
        0.5020730192344555,
      ],
    },
    {
      input: [
        -0.26166346708571764,
        0.05700822935427041,
        -0.12658269144032452,
        0.23858057524765863,
        0.6706529004236654,
      ],
      output: [
        -1.0437750321479116,
        -0.1574946129008506,
      ],
    },
    {
      input: [
        0.8298908783172361,
        0.7487983407578582,
        0.8264524602870149,
        0.3100129531201845,
        -0.06890935330582781,
      ],
      output: [
        0.21550554208538708,
        -0.23349419075875427,
      ],
    },
    {
      input: [
        0.07274516839478506,
        -0.8564613049482825,
        -0.4246221010490494,
        0.5727547580996868,
        -0.040500646321060874,
      ],
      output: [
        -0.9956788684939878,
        0.16876408486807865,
      ],
    },
    {
      input: [
        0.9030478597545017,
        -0.2040822686134307,
        -0.8409870842681149,
        0.7881576021619758,
        -0.7575061473084821,
      ],
      output: [
        0.512095739074109,
        0.27912176820251644,
      ],
    },
    {
      input: [
        -0.05834901018477012,
        0.3564900850298125,
        -0.25382648904807725,
        0.6445517843940216,
        0.9346657941399465,
      ],
      output: [
        -1.1650754046098202,
        -0.5411301074887387,
      ],
    },
  ];

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  ts.forEach((item) => {
    const result = creatureA.noTraceActivate(item.input);

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const internalJSON = creatureA.internalJSON();

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

    const result1 = await creatureB.train(ts, {
      iterations: 2,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/first.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    const result2 = await creatureB.train(ts, {
      iterations: 100,
      error: 0,
    });

    Deno.writeTextFileSync(
      ".trace/last.json",
      JSON.stringify(creatureB.internalJSON(), null, 2),
    );

    if (result2.error < 0.0001) break;
    if (attempts < 12) {
      if (result1.error <= result2.error) continue;
    }

    assert(result1.error >= result2.error, `Didn't improve error`);

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(result2.trace, null, 2),
    );

    // creatureA.nodes.forEach((n, indx) => {
    //   const biasB = creatureB.nodes[indx].bias;
    //   assertAlmostEquals(n.bias ? n.bias : 0, biasB ? biasB : 0, 0.05);
    // });

    // creatureA.connections.forEach((c, indx) => {
    //   const weightA = c.weight;
    //   const weightB = creatureB.connections[indx].weight;
    //   assertAlmostEquals(weightA, weightB, 0.2);
    // });

    break;
  }
});
