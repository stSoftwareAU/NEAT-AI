import { assert, assertAlmostEquals, fail } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

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

function makeOutput(input: number[]) {
  const h3 = (input[0] * -0.1) + (input[1] * 0.2) - 0.3;

  const o4 = (h3 * 0.4) - 0.5;
  const o5 = (h3 * -0.6) + (input[2] * 0.7) + 0.8;

  const output = [o4, o5];

  output.forEach((value, indx) => {
    assert(Number.isFinite(value), `${indx}: ${value}`);
  });
  return output;
}

Deno.test("OneAndDone", () => {
  const creature = makeCreature();
  const traceDir = ".trace/OneAndDone";
  ensureDirSync(traceDir);
  const config = createBackPropagationConfig({
    disableRandomSamples: false,
    generations: 0,
    learningRate: 1,
  });

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  const input = [-1, 0, 1];
  const expected = makeOutput(input);
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  for (let i = 0; i < 100; i++) {
    creature.activateAndTrace(new Float32Array(input), false, sparseConfig);

    creature.propagate(new Float32Array(expected), config, sparseConfig);
  }

  Deno.writeTextFileSync(
    `${traceDir}/1-trace.json`,
    JSON.stringify(creature.traceJSON(), null, 1),
  );

  creature.propagateUpdate(config, sparseConfig);

  const actual = creature.activate(new Float32Array(input));

  Deno.writeTextFileSync(
    `${traceDir}/2-done.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  assertAlmostEquals(
    actual[0],
    expected[0],
    0.7,
    `0: ${actual[0].toFixed(3)} ${expected[0].toFixed(3)}`,
  );
  assertAlmostEquals(
    actual[1],
    expected[1],
    0.7,
    `0: ${actual[1].toFixed(3)} ${expected[1].toFixed(3)}`,
  );
});

Deno.test("TwoSame", () => {
  const traceDir = ".trace/TwoSame";
  ensureDirSync(traceDir);

  const inA = [-1, 0, 1];
  const expectedA = makeOutput(inA);
  for (let attempts = 0; true; attempts++) {
    const creature = makeCreature();

    Deno.writeTextFileSync(
      `${traceDir}/0-start.json`,
      JSON.stringify(creature.traceJSON(), null, 1),
    );
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 1,
      limitBiasScale: 5,
      limitWeightScale: 5,
    });

    const sparseConfig = new SparseConfig(creature.exportJSON(), config);
    for (let i = 0; i < 2; i++) {
      creature.activateAndTrace(new Float32Array(inA), false, sparseConfig);

      creature.propagate(new Float32Array(expectedA), config, sparseConfig);
    }

    Deno.writeTextFileSync(
      `${traceDir}/1-trace.json`,
      JSON.stringify(creature.traceJSON(), null, 1),
    );

    creature.propagateUpdate(config, sparseConfig);
    creature.clearState();

    const actualA = creature.activate(new Float32Array(inA));

    Deno.writeTextFileSync(
      `${traceDir}/2-done.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );

    if (
      (
        Math.abs(expectedA[0] - actualA[0]) < 0.5 &&
        Math.abs(expectedA[1] - actualA[1]) < 0.5
      ) || attempts > 240
    ) {
      assertAlmostEquals(
        expectedA[0],
        actualA[0],
        0.5,
        `0: ${expectedA[0].toFixed(3)} ${
          actualA[0].toFixed(3)
        }, attempts: ${attempts}`,
      );
      assertAlmostEquals(
        expectedA[1],
        actualA[1],
        0.5,
        `1: ${expectedA[1].toFixed(3)} ${
          actualA[1].toFixed(3)
        }, attempts: ${attempts}`,
      );
      break;
    }
  }
});

Deno.test("ManySame", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  ensureDirSync(traceDir);
  for (let attempts = 0; true; attempts++) {
    const config = createBackPropagationConfig({
      disableRandomSamples: true,
      generations: 0,
      maximumWeightAdjustmentScale: 3,
      maximumBiasAdjustmentScale: 3,
      learningRate: 1,
    });

    Deno.writeTextFileSync(
      ".trace/0-start.json",
      JSON.stringify(creature.traceJSON(), null, 1),
    );

    const inA = [-1, 0, 1];
    const expectedA = makeOutput(inA);
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);
    for (let i = 0; i < 1000; i++) {
      creature.activateAndTrace(new Float32Array(inA), false, sparseConfig);

      creature.propagate(new Float32Array(expectedA), config, sparseConfig);
    }

    Deno.writeTextFileSync(
      ".trace/1-inA.json",
      JSON.stringify(creature.traceJSON(), null, 1),
    );

    creature.propagateUpdate(config, sparseConfig);
    creature.clearState();

    const actualA = creature.activate(new Float32Array(inA));

    Deno.writeTextFileSync(
      ".trace/4-done.json",
      JSON.stringify(creature.exportJSON(), null, 1),
    );

    if (
      (
        Math.abs(expectedA[0] - actualA[0]) < 0.02 &&
        Math.abs(expectedA[1] - actualA[1]) < 0.02
      ) || attempts > 120
    ) {
      assertAlmostEquals(
        expectedA[0],
        actualA[0],
        0.02,
        `expected ${expectedA[0].toFixed(3)}, actual: ${
          actualA[0].toFixed(3)
        }, attempt: ${attempts}`,
      );
      assertAlmostEquals(
        expectedA[1],
        actualA[1],
        0.02,
        `expected ${expectedA[1].toFixed(3)}, actual: ${
          actualA[1].toFixed(3)
        }, attempt: ${attempts}`,
      );
      break;
    }
  }
});

Deno.test("propagateSingleNeuronRandom", () => {
  const creature = makeCreature();
  Deno.writeTextFileSync(
    ".trace/0-start.json",
    JSON.stringify(creature.traceJSON(), null, 1),
  );
  const config = createBackPropagationConfig({});

  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  for (let i = 0; i < 1_000; i++) {
    const inC = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    creature.activateAndTrace(new Float32Array(inC), false, sparseConfig);
    creature.propagate(new Float32Array(makeOutput(inC)), config, sparseConfig);
  }

  creature.propagateUpdate(config, sparseConfig);

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.internalJSON(), null, 1),
  );

  for (let loop = 0; loop < 5; loop++) {
    const inD = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    const expectedOutput = makeOutput(inD);
    const actualOutput = creature.activate(new Float32Array(inD));

    if (
      Math.abs(expectedOutput[0] - actualOutput[0]) > 0.7 ||
      Math.abs(expectedOutput[1] - actualOutput[1]) > 0.7
    ) {
      if (loop > 12) fail("too many failures");
    }
  }
});
