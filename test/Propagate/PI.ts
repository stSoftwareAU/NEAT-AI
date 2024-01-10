import {
  assertAlmostEquals,
} from "https://deno.land/std@0.211.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkExport } from "../../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const creatureJSON: NetworkExport = {
    nodes: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0,
      },
    ],
    connections: [
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Network.fromJSON(creatureJSON);
  creature.validate();

  return creature;
}

function makeOutput(input: number[]) {
  return [Math.PI * input[1]];
}

Deno.test("PI", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const config = new BackPropagationConfig({
    useAverageWeight: "Yes",
    generations: 0,
    maximumBiasAdjustmentScale: 2,
    maximumWeightAdjustmentScale: 2,
    learningRate: 1,
  });
  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inA = [-1, 1, 0];
  const outA1 = creature.noTraceActivate(inA);
  const outA2 = creature.activate(inA);
  const expectedA = makeOutput(inA);

  assertAlmostEquals(outA1[0], outA2[0], 0.0001);
  creature.propagate(expectedA, config);

  Deno.writeTextFileSync(
    ".trace/1.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);

  const actualA1 = creature.activate(inA);
  const actualA2 = creature.noTraceActivate(inA);

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

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
});

Deno.test("PI Multiple", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const config = new BackPropagationConfig({
    useAverageWeight: "Yes",
    useAverageDifferenceBias: "Yes",
    generations: 0,
    maximumBiasAdjustmentScale: 5,
    maximumWeightAdjustmentScale: 5,
    learningRate: 1,
  });

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < 1_000; i++) {
    const inC = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    creature.activate(inC);
    creature.propagate(makeOutput(inC), config);
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);

  const inA = [-1, 1, 0];
  const expectedA = makeOutput(inA);
  const actualA1 = creature.activate(inA);
  const actualA2 = creature.noTraceActivate(inA);
  console.info(expectedA, actualA1, actualA2);

  Deno.writeTextFileSync(
    ".trace/3.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

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
});
