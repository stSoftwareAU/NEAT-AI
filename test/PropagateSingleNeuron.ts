import { emptyDirSync } from "https://deno.land/std@0.208.0/fs/empty_dir.ts";

import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

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
  console.info(`i0: ${input[0]}, i1: ${input[1]}, i2: ${input[2]}`);
  console.info(`h3: ${h3}`);
  console.info(`o4: ${o4}, o5: ${o5}`);

  output.forEach((value, indx) => {
    assert(Number.isFinite(value), `${indx}: ${value}`);
  });
  return output;
}

Deno.test("propagateSingleNeuronKnown", () => {
  const creature = makeCreature();
  const traceDir = ".trace";
  emptyDirSync(traceDir);

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
  creature.propagate(makeOutput(inA));

  Deno.writeTextFileSync(
    ".trace/1-inA.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );
  const inB = [1, 1, 1];
  creature.activate(inB);
  const expectedB = makeOutput(inB);
  creature.propagate(expectedB);

  Deno.writeTextFileSync(
    ".trace/2-inB.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );
  const inC = [-0.3, -0.1, 0.1];
  creature.activate(inC);
  const expectedC = makeOutput(inC);
  creature.propagate(expectedC);

  Deno.writeTextFileSync(
    ".trace/3-inC.json",
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate();

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
  const traceDir = ".trace";
  emptyDirSync(traceDir);

  for (let i = 0; i < 1000; i++) {
    const inC = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    creature.activate(inC);
    creature.propagate(makeOutput(inC));
  }

  creature.propagateUpdate();

  Deno.writeTextFileSync(
    ".trace/4-done.json",
    JSON.stringify(creature.internalJSON(), null, 2),
  );

  for (let i = 0; i < 5; i++) {
    const inD = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    const expectedOutput = makeOutput(inD);
    const actualOutput = creature.noTraceActivate(inD);
    console.info(expectedOutput, actualOutput);
    assertAlmostEquals(expectedOutput[0], actualOutput[0], 0.5);
    assertAlmostEquals(expectedOutput[1], actualOutput[1], 0.5);
    // creature.propagate(makeOutput(inC));
  }

  /*
   *  i0 i1 i2
   *  h3=(i0 * -0.1) + (i1 * 0.2) - 0.3
   *  o4=(h3 * 0.4) - 0.5
   *  o5=(h3 * -0.6) + (i2 * 0.7 ) + 0.8
   */
  const json = creature.internalJSON();
  console.info(json);
  json.nodes.forEach((n) => {
    switch (n.index) {
      case 3:
        assertAlmostEquals(n.bias ? n.bias : 0, 0.3, 0.05);
        break;
    }
  });
});
