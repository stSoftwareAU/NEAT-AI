import { emptyDirSync } from "https://deno.land/std@0.210.0/fs/empty_dir.ts";

import {
  assertAlmostEquals,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkExport } from "../src/architecture/NetworkInterfaces.ts";

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
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Network.fromJSON(creatureJSON);
  creature.validate();

  return creature;
}

function makeOutput(input: number[]) {
  const sum = Math.PI + input[0] * Math.E + input[1] * Math.SQRT2 +
    input[2] * Math.LN2;

  return [sum];
}

Deno.test("Constants", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inA = [-1, 1, 0];
  const outA1 = creature.noTraceActivate(inA);
  const outA2 = creature.activate(inA);
  const expectedA = makeOutput(inA);
  console.info("FIRST", outA1, outA2, expectedA);
  assertAlmostEquals(outA1[0], outA2[0], 0.0001);
  creature.propagate(expectedA);

  Deno.writeTextFileSync(
    ".trace/1.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate();

  const actualA1 = creature.activate(inA);
  const actualA2 = creature.noTraceActivate(inA);
  console.info(expectedA, actualA1, actualA2);

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

Deno.test("Constants Same", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < 1_000; i++) {
    const input = [-0.5, 0, 0.5];
    creature.activate(input);
    creature.propagate(makeOutput(input), { disableRandomList: true });
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate();

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
    0.5,
    `0: ${expectedA[0].toFixed(3)} ${actualA1[0].toFixed(3)}`,
  );

  assertAlmostEquals(
    expectedA[0],
    actualA2[0],
    0.5,
    `0: ${expectedA[0].toFixed(3)} ${actualA2[0].toFixed(3)}`,
  );
});

Deno.test("Constants Few", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < 3; i++) {
    const input = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    console.info(input);
    creature.activate(input);
    creature.propagate(makeOutput(input), { disableRandomList: true });
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate();

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

Deno.test("Constants Known Few", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inputs = [
    [-0.6221729575213817, -0.7553897617773555, 0.13402074408170073],
    [0.5652223287089484, -0.08786197216796943, -0.07580976670477835],
    [-0.3625857055962145, -0.31442846346985, -0.4490761153186331],
  ];
  for (let indx = 0; indx < inputs.length; indx++) {
    const input = inputs[indx];
    console.info(input);
    creature.activate(input);
    creature.propagate(makeOutput(input), { disableRandomList: true });
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate();

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

Deno.test("Constants Many", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    ".trace/0.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < 1_000; i++) {
    const input = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    creature.activate(input);
    creature.propagate(makeOutput(input));
  }

  Deno.writeTextFileSync(
    ".trace/2.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate();

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
