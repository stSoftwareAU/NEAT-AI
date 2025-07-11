import { assert, assertAlmostEquals, assertFalse, fail } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import type {
  CreatureExport,
  CreatureInternal,
} from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Make sure the compact routine remove hidden nodes with no affect */
Deno.test("removeDanglingHidden", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3 },
      { type: "hidden", squash: "LOGISTIC", bias: -0.5, index: 4 },
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 5 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 6 },
      { type: "hidden", squash: "MEAN", bias: -0.25, index: 7 },
      {
        type: "output",
        squash: "IDENTITY",
        index: 8,
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 9,
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 3, to: 8, weight: 0.2 },
      { from: 0, to: 8, weight: 0.25 },
      { from: 3, to: 4, weight: 0.3 },
      { from: 2, to: 5, weight: 0.4 },
      { from: 1, to: 6, weight: 0.5 },
      { from: 4, to: 7, weight: 0.7 },
      { from: 6, to: 8, weight: 0.8 },
      { from: 7, to: 9, weight: 0.9 },
    ],
    input: 3,
    output: 2,
  };
  const a = Creature.fromJSON(json);

  const b = a.compact(false);
  assert(b, "should have compacted the network");
  b.validate();
});

Deno.test("removeFeedbackLoop", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 2 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
        type: "output",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { weight: 0.3, fromUUID: "input-1", toUUID: "hidden-3" },

      { toUUID: "hidden-4", weight: -0.5, fromUUID: "hidden-3" },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "hidden-4", toUUID: "hidden-4", weight: -0.7 },
      { fromUUID: "output-0", toUUID: "hidden-4", weight: -0.2 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const a = Creature.fromJSON(json);
  a.validate();

  const b = a.compact(true);
  assertFalse(b, "should not have removed feedback loop");

  const c = a.compact(false);
  assert(c, "should have removed feedback loop");
  c.validate();
});

Deno.test("CompactSimple", () => {
  const directory = ".test/CompactSimple";
  Deno.mkdirSync(directory, { recursive: true });

  const a = new Creature(2, 2, {
    layers: [
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: IDENTITY.NAME },
    ],
    outputLayer: {
      squash: IDENTITY.NAME,
    },
  });

  a.validate();

  const startNodes = a.neurons.length;
  const startConnections = a.synapses.length;

  const input = new Float32Array([0.1, 0.2]);
  const startOut = a.activate(input);

  Deno.writeTextFileSync(
    `${directory}/0-start.json`,
    JSON.stringify(a.exportJSON(), null, 1),
  );
  a.fix();

  Deno.writeTextFileSync(
    `${directory}/1-fixed.json`,
    JSON.stringify(a.exportJSON(), null, 1),
  );
  const midOut = a.activate(input);

  assertAlmostEquals(midOut[0], startOut[0], 0.001);
  assertAlmostEquals(midOut[1], startOut[1], 0.001);

  const c = a.compact(false);

  assert(c, "should have compacted the network");

  c.validate();
  Deno.writeTextFileSync(
    `${directory}/2-end.json`,
    JSON.stringify(c.exportJSON(), null, 1),
  );

  const endNodes = c.neurons.length;
  const endConnections = c.synapses.length;

  const endOut = c.activate(input);

  assertAlmostEquals(startOut[0], endOut[0], 0.001);
  assertAlmostEquals(startOut[1], endOut[1], 0.001);
  assert(endNodes < startNodes);
  assert(endConnections < startConnections);

  // const d = c.compact();
  // assert(!d);
});

Deno.test("RandomizeCompact", () => {
  for (let attempts = 0; true; attempts++) {
    const traceDir = ".trace/RandomizeCompact";
    ensureDirSync(traceDir);
    const a = new Creature(2, 2, {
      layers: [
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1 },
        { count: 1 },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
        { count: 1, squash: "*" },
      ],
    });

    a.validate();

    const startNodes = a.neurons.length;
    const startConnections = a.synapses.length;

    const input = new Float32Array([0.1, 0.2]);
    const startOut = a.activate(input);

    Deno.writeTextFileSync(
      `${traceDir}/a.json`,
      JSON.stringify(a.exportJSON(), null, 1),
    );
    const b = a.compact(false);
    if (!b) {
      console.info("Did not compact");
      break;
    } else {
      b.DEBUG = false;
      Deno.writeTextFileSync(
        `${traceDir}/b.json`,
        JSON.stringify(b.exportJSON(), null, 1),
      );
      b.DEBUG = true;
      b.validate();
      const endNodes = b.neurons.length;
      const endConnections = b.synapses.length;

      const endOut = b.activate(input);

      assertAlmostEquals(startOut[0], endOut[0], 0.1);
      assertAlmostEquals(startOut[1], endOut[1], 0.1);
      assert(endNodes <= startNodes);
      assert(endConnections <= startConnections);

      const c = b.compact(false);
      if (c) {
        const d = c.compact(false);
        if (!d) break;

        if (attempts > 13) {
          fail(`failed after ${attempts}`);
        }
      } else {
        break;
      }
    }
  }
});

Deno.test("CompactSelf", () => {
  const directory = ".test/CompactSelf";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3 },
      { type: "hidden", squash: "LOGISTIC", bias: -0.5, index: 4 },
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 5 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 6 },
      { type: "hidden", squash: "MEAN", bias: -0.25, index: 7 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 8,
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 3, to: 8, weight: 0.2, type: "positive" },
      { from: 0, to: 8, weight: 0.25, type: "positive" },
      { from: 3, to: 4, weight: 0.3, type: "condition" },
      { from: 2, to: 5, weight: 0.4, type: "negative" },
      { from: 1, to: 6, weight: 0.5, type: "negative" },
      { from: 4, to: 7, weight: 0.7, type: "negative" },
      { from: 5, to: 7, weight: 0.7, type: "negative" },
      { from: 6, to: 7, weight: 0.7, type: "negative" },
      { from: 7, to: 7, weight: 0.7, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const a = Creature.fromJSON(json);

  a.validate();

  const startNodes = a.neurons.length;
  const startConnections = a.synapses.length;

  const input = new Float32Array([0.1, 0.2, 0.3]);
  const aOut = a.activate(input);

  Deno.writeTextFileSync(
    `${directory}/0-start.json`,
    JSON.stringify(a.exportJSON(), null, 1),
  );

  const aOut2 = a.activate(input);

  assertAlmostEquals(aOut[0], aOut2[0], 0.001);
  const b = a.compact(false);

  assert(b, "should have compacted the network");

  b.validate();
  Deno.writeTextFileSync(
    `${directory}/1-end.json`,
    JSON.stringify(b.exportJSON(), null, 1),
  );

  const endNodes = b.neurons.length;
  const endConnections = b.synapses.length;

  const endOut = b.activate(input);

  assertAlmostEquals(aOut[0], endOut[0], 0.001);
  assert(endNodes < startNodes);
  assert(endConnections < startConnections);

  const c = b.compact(false);
  assert(!c);
});
