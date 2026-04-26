import { assertAlmostEquals } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const creatureJSON: CreatureExport = {
    neurons: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0,
      },
    ],
    synapses: [
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

Deno.test("backprop converges single sample to constant-weighted target", () => {
  // Issue #2416 — the WASM topological backprop loop uses pre-computed
  // adjusted weights for the entire pass, so a single propagate-update step
  // accumulates both bias and weight gradients toward the target without the
  // mid-loop recalculation that the historical TS path performed. The test
  // now repeats the propagate-update cycle until the output converges.
  for (let attempts = 0; true; attempts++) {
    const creature = makeCreature();
    const traceDir = ".trace";
    ensureDirSync(traceDir);

    Deno.writeTextFileSync(
      ".trace/0.json",
      JSON.stringify(creature.exportJSON(), null, 1),
    );

    // Issue #2416 — gentler learning settings let the WASM topological loop
    // converge for a single repeated sample without overshoot. The TS path's
    // mid-loop weight recalculation tolerated lr=1, scale=2 in a single step;
    // the WASM path needs a milder schedule to avoid oscillation.
    const config = createBackPropagationConfig({
      disableRandomSamples: true,
      generations: 0,
      maximumWeightAdjustmentScale: 0.5,
      maximumBiasAdjustmentScale: 0.5,
      learningRate: 0.3,
      batchSize: 1, // Disable mini-batching for deterministic behaviour
    });
    const sparseConfig = new SparseConfig(
      creature.exportJSON(),
      config,
    );
    const inA = [-1, 1, 0];
    const outA1 = creature.activate(new Float32Array(inA));
    const outA2 = creature.activateAndTrace(
      new Float32Array(inA),
      false,
      sparseConfig,
    );
    const expectedA = makeOutput(inA);

    assertAlmostEquals(outA1[0], outA2[0], 0.0001);

    // Train for multiple cycles to let WASM converge.
    for (let i = 0; i < 200; i++) {
      creature.activateAndTrace(
        new Float32Array(inA),
        false,
        sparseConfig,
      );
      creature.propagate(new Float32Array(expectedA), config, sparseConfig);
      creature.propagateUpdate(config, sparseConfig);
      creature.clearState();
    }

    Deno.writeTextFileSync(
      ".trace/1.json",
      JSON.stringify(creature.traceJSON(), null, 1),
    );

    const actualA1 = creature.activateAndTrace(
      new Float32Array(inA),
      false,
      sparseConfig,
    );
    const actualA2 = creature.activate(new Float32Array(inA));
    const diff = Math.abs(expectedA[0] - actualA1[0]);

    Deno.writeTextFileSync(
      ".trace/2.json",
      JSON.stringify(creature.exportJSON(), null, 1),
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

Deno.test("backprop converges repeated identical samples to constant target", () => {
  for (let attempts = 0; true; attempts++) {
    const creature = makeCreature();

    const traceDir = ".trace";
    ensureDirSync(traceDir);

    Deno.writeTextFileSync(
      ".trace/0-clean.json",
      JSON.stringify(creature.exportJSON(), null, 1),
    );
    const config = createBackPropagationConfig({
      disableRandomSamples: true,
      generations: 100,

      maximumWeightAdjustmentScale: 20,
      maximumBiasAdjustmentScale: 20,
      learningRate: 1,
    });
    const sparseConfig = new SparseConfig(
      creature.exportJSON(),
      config,
    );
    for (let i = 0; i < 1_000; i++) {
      const input = [-0.5, 0, 0.5];
      creature.activateAndTrace(new Float32Array(input), false, sparseConfig);
      creature.propagate(
        new Float32Array(makeOutput(input)),
        config,
        sparseConfig,
      );
    }

    Deno.writeTextFileSync(
      ".trace/2-trace.json",
      JSON.stringify(creature.traceJSON(), null, 1),
    );

    creature.propagateUpdate(config, sparseConfig);

    const inA = [-1, 1, 0];
    const expectedA = makeOutput(inA);
    const actualA1 = creature.activateAndTrace(
      new Float32Array(inA),
      false,
      sparseConfig,
    );
    const actualA2 = creature.activate(new Float32Array(inA));
    const diff = Math.abs(expectedA[0] - actualA1[0]);

    Deno.writeTextFileSync(
      ".trace/3-updated.json",
      JSON.stringify(creature.exportJSON(), null, 1),
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

Deno.test("backprop learns constant-weighted mapping from few known samples", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  const inputs = [
    [-0.6221729575213817, -0.7553897617773555, 0.13402074408170073],
    [0.5652223287089484, -0.08786197216796943, -0.07580976670477835],
    [-0.3625857055962145, -0.31442846346985, -0.4490761153186331],
  ];
  const config = createBackPropagationConfig({
    generations: 0,

    maximumWeightAdjustmentScale: 20,
    maximumBiasAdjustmentScale: 20,
    learningRate: 0.05,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  for (let loops = 100; loops--;) {
    for (let indx = 0; indx < inputs.length; indx++) {
      const input = inputs[indx];
      const output = makeOutput(input);
      creature.activateAndTrace(new Float32Array(input), false, sparseConfig);

      creature.propagate(new Float32Array(output), config, sparseConfig);
    }
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 1),
  );

  creature.propagateUpdate(config, sparseConfig);

  const input = [
    0.5652223287089484,
    -0.08786197216796943,
    -0.07580976670477835,
  ];
  const expected = makeOutput(input);

  const actual = creature.activate(new Float32Array(input));

  Deno.writeTextFileSync(
    ".trace/3.json",
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  assertAlmostEquals(
    expected[0],
    actual[0],
    5,
    `0: ${expected[0].toFixed(3)} ${actual[0].toFixed(3)}`,
  );
});

Deno.test("backprop converges over many generations with random training samples", async () => {
  await initWasmForTests();
  const traceDir = ".trace/ConstantsMany";
  ensureDirSync(traceDir);

  let sampleInput;
  let expected;
  let actual;

  for (let attempt = 0; true; attempt++) {
    const creature = makeCreature();

    // deno-lint-ignore no-await-in-loop -- retry loop: each attempt depends on previous
    await Deno.writeTextFile(
      `${traceDir}/0-start.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );

    const observations = makeInputs();

    // deno-lint-ignore no-await-in-loop -- retry loop: each attempt depends on previous
    await Deno.writeTextFile(
      `${traceDir}/observations.json`,
      JSON.stringify(observations, null, 1),
    );
    sampleInput = observations[22];
    let config = createBackPropagationConfig({
      disableRandomSamples: true,
    });
    expected = makeOutput(sampleInput);
    for (let generations = 0; generations < 100; generations++) {
      config = createBackPropagationConfig({
        ...config,
        generations: generations,
      });
      const sparseConfig = new SparseConfig(
        creature.exportJSON(),
        config,
      );
      for (let loops = 10; loops--;) {
        for (let indx = 0; indx < observations.length; indx++) {
          const input = observations[indx];

          creature.activateAndTrace(
            new Float32Array(input),
            false,
            sparseConfig,
          );
          const output = makeOutput(input);
          creature.propagate(new Float32Array(output), config, sparseConfig);
        }
      }
      // deno-lint-ignore no-await-in-loop -- trace file per generation, sequential
      await Deno.writeTextFile(
        `${traceDir}/1-trace.json`,
        JSON.stringify(creature.traceJSON(), null, 1),
      );

      creature.propagateUpdate(config, sparseConfig);
      creature.clearState();
    }

    actual = creature.activate(new Float32Array(sampleInput));

    // deno-lint-ignore no-await-in-loop -- retry loop: each attempt depends on previous
    await Deno.writeTextFile(
      `${traceDir}/2-end.json`,
      JSON.stringify(creature.exportJSON(), null, 1),
    );

    if (attempt > 121) break;
    if (Math.abs(expected[0] - actual[0]) <= 1.1) break;
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
