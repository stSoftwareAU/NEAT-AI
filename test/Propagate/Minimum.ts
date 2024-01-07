import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.211.0/assert/mod.ts";

import { Network } from "../../src/architecture/Network.ts";
import { NetworkExport } from "../../src/architecture/NetworkInterfaces.ts";
import { Costs } from "../../src/Costs.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("PropagateMinimum", async () => {
  const creature = makeCreature();

  const ts: { input: number[]; output: number[] }[] = []; //JSON.parse( Deno.readTextFileSync(".trace/data.json"));
  for (let i = 1_000; i--;) {
    const input = makeInput();
    const output = creature.noTraceActivate(input);

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
    const result = creature.noTraceActivate(item.input);

    assertAlmostEquals(item.output[0], result[0], 0.00001);
    assertAlmostEquals(item.output[1], result[1], 0.00001);
  });

  const exportJSON = creature.exportJSON();

  Deno.writeTextFileSync(
    ".trace/A-clean.json",
    JSON.stringify(exportJSON, null, 2),
  );

  exportJSON.nodes.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 == 0 ? 1 : -1) * 0.1);
  });

  exportJSON.connections.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.1);
  });

  Deno.writeTextFileSync(
    ".trace/B-modified.json",
    JSON.stringify(exportJSON, null, 2),
  );

  const creatureB = Network.fromJSON(exportJSON);
  creatureB.validate();

  const errorB = calculateError(creatureB, ts);

  for (let attempts = 0; true; attempts++) {
    const creatureC = Network.fromJSON(exportJSON);
    creatureC.validate();

    const resultC = await creatureC.train(ts, {
      iterations: 1000,
      error: errorB - 0.001,
      disableRandomSamples: true,
    });

    Deno.writeTextFileSync(
      ".trace/C-trace.json",
      JSON.stringify(resultC.trace, null, 2),
    );

    Deno.writeTextFileSync(
      ".trace/C-creature.json",
      JSON.stringify(creatureC.exportJSON(), null, 2),
    );

    if (attempts < 12) {
      if (errorB <= resultC.error) continue;
    }

    if (!resultC.trace) throw new Error("No trace");
    const creatureD = Network.fromJSON(
      Network.fromJSON(resultC.trace).exportJSON(),
    );
    const creatureE = Network.fromJSON(resultC.trace);
    const config = new BackPropagationConfig({
      useAverageValuePerActivation: "No",
      useAverageDifferenceBias: "Yes",
      generations: 0,
    });

    creatureE.applyLearnings(config);
    const errorC = calculateError(creatureC, ts);
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
      ".trace/D-trace.json",
      JSON.stringify(creatureD.traceJSON(), null, 2),
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
  creature: Network,
  json: { input: number[]; output: number[] }[],
) {
  let error = 0;
  const count = json.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = json[i];
    const output = creature.noTraceActivate(data.input, false);
    error += mse.calculate(data.output, output);
  }

  return error / count;
}

function makeCreature() {
  const creatureJson: NetworkExport = {
    nodes: [
      {
        type: "hidden",
        uuid: "7a17dbbd-c3af-4106-bd72-c1abfad641ae",
        bias: -0.2,
        squash: "INVERSE",
      },
      {
        type: "hidden",
        uuid: "3f39a8e0-040e-4b5f-993b-dd75b1ae1caa",
        bias: -0.1,
        squash: "ABSOLUTE",
      },
      {
        type: "hidden",
        uuid: "9577fbbd-e19a-4e37-9a48-dfb6c63c03f2",
        bias: 0.3,
        squash: "CLIPPED",
      },
      {
        type: "hidden",
        uuid: "c4ed5836-d608-4124-afe8-31a5d00b932d",
        bias: -0.3,
        squash: "RELU",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0.4,
        squash: "MINIMUM",
      },
      {
        type: "output",
        uuid: "output-1",
        bias: 0.3,
        squash: "MINIMUM",
      },
    ],
    connections: [
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

  const creature = Network.fromJSON(creatureJson);
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
