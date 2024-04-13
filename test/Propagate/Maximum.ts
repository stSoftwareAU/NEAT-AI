import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.222.1/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.222.1/fs/mod.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { train } from "../../src/architecture/Training.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("PropagateMaximum", async () => {
  const creatureA = makeCreature();
  for (let attempts = 0; true; attempts++) {
    const ts: { input: number[]; output: number[] }[] = []; //JSON.parse( Deno.readTextFileSync(".trace/data.json"));
    for (let i = 1_00; i--;) {
      const input = makeInput();
      const output = creatureA.activate(input);

      ts.push({
        input,
        output,
      });
    }

    const traceDir = ".trace";
    ensureDirSync(traceDir);

    Deno.writeTextFileSync(
      ".trace/data.json",
      JSON.stringify(ts, null, 2),
    );
    ts.forEach((item) => {
      const result = creatureA.activate(item.input);

      assertAlmostEquals(item.output[0], result[0], 0.00001);
      assertAlmostEquals(item.output[1], result[1], 0.00001);
    });

    const exportJSON = creatureA.exportJSON();

    Deno.writeTextFileSync(
      ".trace/A-clean.json",
      JSON.stringify(exportJSON, null, 2),
    );

    exportJSON.neurons.forEach((node, indx) => {
      node.bias = node.bias +
        ((indx % 2 == 0 ? 1 : -1) * 0.15);
    });

    exportJSON.synapses.forEach((c, indx) => {
      c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.15);
    });

    Deno.writeTextFileSync(
      ".trace/B-modified.json",
      JSON.stringify(exportJSON, null, 2),
    );

    const creatureB = Creature.fromJSON(exportJSON);
    creatureB.validate();

    const errorB = calculateError(creatureB, ts);

    const creatureC = Creature.fromJSON(exportJSON);
    creatureC.validate();

    const resultC = await train(creatureC, ts, {
      iterations: 100,
      targetError: errorB - 0.001,
      // disableRandomSamples: true,
    });

    Deno.writeTextFileSync(
      ".trace/C-trace.json",
      JSON.stringify(resultC.trace, null, 2),
    );

    Deno.writeTextFileSync(
      ".trace/C-creature.json",
      JSON.stringify(creatureC.exportJSON(), null, 2),
    );

    const errorC = calculateError(creatureC, ts);

    if (attempts < 24) {
      if (errorB <= errorC) continue;
    }

    if (!resultC.trace) throw new Error("No trace");
    const creatureD = Creature.fromJSON(
      Creature.fromJSON(resultC.trace).exportJSON(),
    );
    const creatureE = Creature.fromJSON(resultC.trace);
    const config = new BackPropagationConfig({
      // useAverageValuePerActivation: false,
      // useAverageDifferenceBias: "Yes",
      // generations: 50,
    });

    creatureE.applyLearnings(config);
    const errorD = calculateError(creatureD, ts);
    const errorE = calculateError(creatureE, ts);
    console.log(
      `Error: B: ${errorB}, C: ${errorC}, D: ${errorD}, E: ${errorE}`,
    );

    Deno.writeTextFileSync(
      ".trace/D-creature.json",
      JSON.stringify(creatureD.exportJSON(), null, 2),
    );

    Deno.writeTextFileSync(
      ".trace/E-creature.json",
      JSON.stringify(creatureE.exportJSON(), null, 2),
    );

    assert(
      errorB > errorC,
      `Didn't improve error B->C  start: ${errorB} end: ${errorC}`,
    );

    assert(
      errorB > resultC.error,
      `Didn't improve error B->C *reported*  start: ${errorB} end: ${resultC.error}`,
    );

    Deno.writeTextFileSync(
      ".trace/result.json",
      JSON.stringify(resultC.trace, null, 2),
    );

    break;
  }
});

function calculateError(
  creature: Creature,
  json: { input: number[]; output: number[] }[],
) {
  let error = 0;
  const count = json.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = json[i];
    const output = creature.activate(data.input, false);
    error += mse.calculate(data.output, output);
  }

  return error / count;
}

function makeCreature() {
  const creatureJson: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "7a17dbbd-c3af-4106-bd72-c1abfad641ae",
        bias: -0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "3f39a8e0-040e-4b5f-993b-dd75b1ae1caa",
        bias: -0.1,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
        bias: 0.3,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "c4ed5836-d608-4124-afe8-31a5d00b932d",
        bias: -0.3,
        squash: "IDENTITY",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0.4,
        squash: "MAXIMUM",
      },
      {
        type: "output",
        uuid: "output-1",
        bias: 0.3,
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: -0.7,
        fromUUID: "input-0",
        toUUID: "7a17dbbd-c3af-4106-bd72-c1abfad641ae",
      },
      {
        weight: 0.7,
        fromUUID: "input-1",
        toUUID: "7a17dbbd-c3af-4106-bd72-c1abfad641ae",
      },
      {
        weight: 0.4,
        fromUUID: "input-1",
        toUUID: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
      },
      {
        weight: 0.3,
        fromUUID: "input-2",
        toUUID: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
      },
      {
        weight: 0.6,
        fromUUID: "input-3",
        toUUID: "3f39a8e0-040e-4b5f-993b-dd75b1ae1caa",
      },
      {
        weight: 1.1,
        fromUUID: "input-3",
        toUUID: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
      },
      {
        weight: -0.6,
        fromUUID: "input-4",
        toUUID: "3f39a8e0-040e-4b5f-993b-dd75b1ae1caa",
      },
      {
        weight: 1,
        fromUUID: "7a17dbbd-c3af-4106-bd72-c1abfad641ae",
        toUUID: "output-0",
      },
      {
        weight: -1.1,
        fromUUID: "3f39a8e0-040e-4b5f-993b-dd75b1ae1caa",
        toUUID: "c4ed5836-d608-4124-afe8-31a5d00b932d",
      },
      {
        weight: -0.8,
        fromUUID: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
        toUUID: "c4ed5836-d608-4124-afe8-31a5d00b932d",
      },
      {
        weight: 0.2,
        fromUUID: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
        toUUID: "output-1",
      },
      {
        weight: -0.5,
        fromUUID: "c4ed5836-d608-4124-afe8-31a5d00b932d",
        toUUID: "output-0",
      },
      {
        weight: -0.4,
        fromUUID: "c4ed5836-d608-4124-afe8-31a5d00b932d",
        toUUID: "output-1",
      },
    ],
    input: 5,
    output: 2,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  return creature;
}

function makeInput() {
  return [
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
  ];
}
