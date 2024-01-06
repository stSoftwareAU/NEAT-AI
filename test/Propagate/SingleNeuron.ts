import { emptyDirSync } from "https://deno.land/std@0.211.0/fs/empty_dir.ts";

import { fail } from "https://deno.land/std@0.211.0/assert/fail.ts";
import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.211.0/assert/mod.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkInternal } from "../../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  /*
   *  i0 i1 i2
   *  h3=(i0 * -0.1) + (i1 * 0.2) - 0.3
   *  o4=(h3 * 0.4) - 0.5
   *  o5=(h3 * -0.6) + (i2 * 0.7 ) + 0.8
   */
  const creatureJsonA: NetworkInternal = {
    nodes: [
      { type: "hidden", index: 3, squash: "IDENTITY", bias: 0 },

      {
        type: "output",
        squash: "IDENTITY",
        index: 4,
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 5,
        bias: 0,
      },
    ],
    connections: [
      /* h3=(i0 * -0.1) + (i1 * 0.2) - 0.3 */
      { from: 0, to: 3, weight: -1 },
      { from: 1, to: 3, weight: 0 },

      /* o4=(h3 * 0.4) - 0.5*/
      { from: 3, to: 4, weight: 1 },

      /* o5=(h3 * -0.6) + (i2 * 0.7 ) + 0.8*/
      { from: 3, to: 5, weight: 1 },
      { from: 2, to: 5, weight: 1 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Network.fromJSON(creatureJsonA);
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
  const traceDir = ".trace";
  emptyDirSync(traceDir);
  const config = new BackPropagationConfig({
    disableRandomList: true,
    // useAverageValuePerActivation: true,
    useAverageValuePerActivation: false,
    useAverageDifferenceBias: "Yes",
    generations: 0,
  });

  Deno.writeTextFileSync(
    ".trace/0-start.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  const inA = [-1, 0, 1];
  creature.activate(inA);
  const expectedA = makeOutput(inA);

  creature.propagate(expectedA, config);

  Deno.writeTextFileSync(
    ".trace/1-inA.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);

  const actualA = creature.noTraceActivate(inA);

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  assertAlmostEquals(
    expectedA[0],
    actualA[0],
    0.7,
    `0: ${expectedA[0].toFixed(3)} ${actualA[0].toFixed(3)}`,
  );
  assertAlmostEquals(
    expectedA[1],
    actualA[1],
    0.7,
    `0: ${expectedA[1].toFixed(3)} ${actualA[1].toFixed(3)}`,
  );
});

Deno.test("TwoSame", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);
  const config = new BackPropagationConfig({
    useAverageValuePerActivation: true,
    useAverageDifferenceBias: "Yes",
    generations: 0,
  });

  Deno.writeTextFileSync(
    ".trace/0-start.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  const inA = [-1, 0, 1];
  const expectedA = makeOutput(inA);

  for (let i = 0; i < 2; i++) {
    creature.activate(inA);

    creature.propagate(expectedA, config);
  }

  Deno.writeTextFileSync(
    ".trace/1-inA.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);

  const actualA = creature.noTraceActivate(inA);

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  assertAlmostEquals(expectedA[0], actualA[0], 0.5);
  assertAlmostEquals(expectedA[1], actualA[1], 0.5);
});

Deno.test("ManySame", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);
  const config = new BackPropagationConfig({
    useAverageValuePerActivation: true,
    useAverageDifferenceBias: "Maybe",
    generations: 0,
  });

  Deno.writeTextFileSync(
    ".trace/0-start.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  const inA = [-1, 0, 1];
  const expectedA = makeOutput(inA);

  for (let i = 0; i < 1000; i++) {
    creature.activate(inA);

    creature.propagate(expectedA, config);
  }

  Deno.writeTextFileSync(
    ".trace/1-inA.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);

  const actualA = creature.noTraceActivate(inA);

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  assertAlmostEquals(expectedA[0], actualA[0], 0.02);
  assertAlmostEquals(expectedA[1], actualA[1], 0.02);
});

Deno.test("propagateSingleNeuronKnown", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);
  const config = new BackPropagationConfig({
    useAverageValuePerActivation: true,
    useAverageDifferenceBias: "Yes",
    generations: 0,
  });

  Deno.writeTextFileSync(
    ".trace/0-start.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  const inFirst = [-0.5, 0, 0.5];
  const actualFirst = creature.noTraceActivate(inFirst);
  const actualFirst2 = creature.noTraceActivate(inFirst);
  const expectedFirst = makeOutput(inFirst);
  console.info("FIRST", expectedFirst, actualFirst, actualFirst2);

  const inA = [0, 0, 0];
  const outA = creature.activate(inA);
  console.info("SECOND", outA);
  creature.propagate(makeOutput(inA), config);

  Deno.writeTextFileSync(
    ".trace/1-inA.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );
  const inB = [1, 1, 1];
  creature.activate(inB);
  const expectedB = makeOutput(inB);
  creature.propagate(expectedB, config);

  Deno.writeTextFileSync(
    ".trace/2-inB.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );
  const inC = [-0.3, -0.1, 0.1];
  const expectedC = makeOutput(inC);
  for (let i = 0; i < 1000; i++) {
    creature.activate(inC);
    creature.propagate(expectedC, config);
  }

  Deno.writeTextFileSync(
    ".trace/3-inC.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);
  const actualC = creature.noTraceActivate(inC);
  console.info(expectedC, actualC);

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inD = [-0.5, 0, 0.5];
  const actualD = creature.noTraceActivate(inD);
  const expectedD = makeOutput(inD);
  console.info("LAST", expectedD, actualD);

  assertAlmostEquals(actualD[0], expectedD[0], 0.5);
  assertAlmostEquals(actualD[1], expectedD[1], 0.5);
});

Deno.test("propagateSingleNeuronRandom", () => {
  const creature = makeCreature();
  Deno.writeTextFileSync(
    ".trace/0-start.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );
  const config = new BackPropagationConfig({
    useAverageValuePerActivation: true,
  });
  console.info(config);
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  for (let i = 0; i < 1_000; i++) {
    const inC = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    creature.activate(inC);
    creature.propagate(makeOutput(inC), config);
  }

  creature.propagateUpdate(config);

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.internalJSON(), null, 2),
  );

  for (let loop = 0; loop < 5; loop++) {
    const inD = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    const expectedOutput = makeOutput(inD);
    const actualOutput = creature.noTraceActivate(inD);

    if (
      Math.abs(expectedOutput[0] - actualOutput[0]) > 0.7 ||
      Math.abs(expectedOutput[1] - actualOutput[1]) > 0.7
    ) {
      if (loop > 12) fail("too many failures");
    }
  }
});