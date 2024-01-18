import {
  assertAlmostEquals,
} from "https://deno.land/std@0.212.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.212.0/fs/ensure_dir.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const creatureJSON: CreatureExport = {
    nodes: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0,
      },
    ],
    connections: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(creatureJSON);
  creature.validate();

  return creature;
}

function makeOutput(input: number[]) {
  const sum = Math.PI + input[0] * Math.E + input[1] * Math.SQRT2 +
    input[2] * Math.LN2;

  return [sum];
}

Deno.test("Constants", () => {
  for (let attempts = 0; true; attempts++) {
    const creature = makeCreature();
    const traceDir = ".trace";
    ensureDirSync(traceDir);

    Deno.writeTextFileSync(
      ".trace/0.json",
      JSON.stringify(creature.exportJSON(), null, 2),
    );

    const config = new BackPropagationConfig({
      disableRandomSamples: true,
      generations: 0,
      maximumWeightAdjustmentScale: 2,
      maximumBiasAdjustmentScale: 2,
      learningRate: 1,
    });
    const inA = [-1, 1, 0];
    const outA1 = creature.activate(inA);
    const outA2 = creature.activateAndTrace(inA);
    const expectedA = makeOutput(inA);

    assertAlmostEquals(outA1[0], outA2[0], 0.0001);
    creature.propagate(expectedA, config);

    Deno.writeTextFileSync(
      ".trace/1.json",
      JSON.stringify(creature.traceJSON(), null, 2),
    );

    creature.propagateUpdate(config);

    const actualA1 = creature.activateAndTrace(inA);
    const actualA2 = creature.activate(inA);
    const diff = Math.abs(expectedA[0] - actualA1[0]);
    console.info(expectedA, actualA1, actualA2, diff);

    Deno.writeTextFileSync(
      ".trace/2.json",
      JSON.stringify(creature.exportJSON(), null, 2),
    );

    if (diff < 0.001 || attempts > 100) {
      assertAlmostEquals(
        expectedA[0],
        actualA1[0],
        0.001,
        `0: ${expectedA[0].toFixed(3)} ${actualA1[0].toFixed(3)}`,
      );

      assertAlmostEquals(
        expectedA[0],
        actualA2[0],
        0.001,
        `0: ${expectedA[0].toFixed(3)} ${actualA2[0].toFixed(3)}`,
      );
      break;
    }
  }
});

Deno.test("Constants Same", () => {
  for (let attempts = 0; true; attempts++) {
    const creature = makeCreature();

    const traceDir = ".trace";
    ensureDirSync(traceDir);

    Deno.writeTextFileSync(
      ".trace/0-clean.json",
      JSON.stringify(creature.exportJSON(), null, 2),
    );
    const config = new BackPropagationConfig({
      disableRandomSamples: true,
      generations: 100,

      maximumWeightAdjustmentScale: 20,
      maximumBiasAdjustmentScale: 20,
      learningRate: 1,
    });
    for (let i = 0; i < 1_000; i++) {
      const input = [-0.5, 0, 0.5];
      creature.activateAndTrace(input);
      creature.propagate(makeOutput(input), config);
    }

    Deno.writeTextFileSync(
      ".trace/2-trace.json",
      JSON.stringify(creature.traceJSON(), null, 2),
    );

    creature.propagateUpdate(config);

    const inA = [-1, 1, 0];
    const expectedA = makeOutput(inA);
    const actualA1 = creature.activateAndTrace(inA);
    const actualA2 = creature.activate(inA);
    const diff = Math.abs(expectedA[0] - actualA1[0]);

    Deno.writeTextFileSync(
      ".trace/3-updated.json",
      JSON.stringify(creature.exportJSON(), null, 2),
    );

    if (diff < 0.5 || attempts > 100) {
      assertAlmostEquals(
        expectedA[0],
        actualA1[0],
        0.5,
        `0: ${expectedA[0].toFixed(3)} ${actualA1[0].toFixed(3)}`,
      );

      assertAlmostEquals(
        expectedA[0],
        actualA2[0],
        0.5,
        `0: ${expectedA[0].toFixed(3)} ${actualA2[0].toFixed(3)}`,
      );
      break;
    }
  }
});

Deno.test("Constants Known Few", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inputs = [
    // [-1, 1, 0],
    [-0.6221729575213817, -0.7553897617773555, 0.13402074408170073],
    [0.5652223287089484, -0.08786197216796943, -0.07580976670477835],
    [-0.3625857055962145, -0.31442846346985, -0.4490761153186331],
  ];
  const config = new BackPropagationConfig({
    // useAverageWeight: "No",
    generations: 0,

    maximumWeightAdjustmentScale: 20,
    maximumBiasAdjustmentScale: 20,
    learningRate: 0.05,
  });

  for (let loops = 100; loops--;) {
    for (let indx = 0; indx < inputs.length; indx++) {
      const input = inputs[indx];
      const output = makeOutput(input);
      creature.activateAndTrace(input);

      creature.propagate(output, config);
    }
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);

  const input = [
    0.5652223287089484,
    -0.08786197216796943,
    -0.07580976670477835,
  ];
  const expected = makeOutput(input);

  const actual = creature.activate(input);

  Deno.writeTextFileSync(
    ".trace/3.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  assertAlmostEquals(
    expected[0],
    actual[0],
    5,
    `0: ${expected[0].toFixed(3)} ${actual[0].toFixed(3)}`,
  );
});

Deno.test("ConstantsMany", () => {
  const traceDir = ".trace/ConstantsMany";
  ensureDirSync(traceDir);


  let sampleInput;

  let expected;
  let actual;
  for (let attempt = 0; true; attempt++) {
    const creature = makeCreature();
    
    Deno.writeTextFileSync(
      `${traceDir}/0-start.json`,
      JSON.stringify(creature.exportJSON(), null, 2),
    );

    const observations = makeInputs();

    Deno.writeTextFileSync(
      `${traceDir}/observations.json`,
      JSON.stringify(observations, null, 2),
    );
    sampleInput = observations[22];
    const config = new BackPropagationConfig({
      disableRandomSamples: true,
    });
    expected = makeOutput(sampleInput);
    for (let generations = 0; generations < 100; generations++) {
      config.generations = generations;

      for (let loops = 10; loops--;) {
        for (let indx = 0; indx < observations.length; indx++) {
          const input = observations[indx];

          creature.activateAndTrace(input);
          const output = makeOutput(input);
          creature.propagate(output, config);
        }
      }
      Deno.writeTextFileSync(
        `${traceDir}/1-trace.json`,
        JSON.stringify(creature.traceJSON(), null, 2),
      );

      creature.propagateUpdate(config);
      creature.clearState();
    }

    const tmpActual = creature.activate(sampleInput);

    actual = creature.activate(sampleInput);

    Deno.writeTextFileSync(
      `${traceDir}/2-end.json`,
      JSON.stringify(creature.exportJSON(), null, 2),
    );

    if (attempt > 121) break;
    if (Math.abs(expected[0] - tmpActual[0]) <= 1.1) break;
    console.info(config);
  }

  assertAlmostEquals(
    expected[0],
    actual[0],
    1.1,
    `0: ${expected[0].toFixed(3)} ${actual[0].toFixed(3)}`,
  );
});

function makeInputs() {
  const inputs: number[][] = [];
  for (let attempts = 100; attempts--;) {
    const input = [
      Math.random() * 3 - 1.5,
      Math.random() * 3 - 1.5,
      Math.random() * 3 - 1.5,
    ];
    inputs.push(input);
  }
  return inputs;
}
