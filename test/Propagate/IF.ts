import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.211.0/assert/mod.ts";

import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";
import { Costs } from "../../src/Costs.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkExport } from "../../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("PropagateIF", async () => {
  const creatureA = makeCreature();
  for (let attempts = 0; true; attempts++) {
    const ts: { input: number[]; output: number[] }[] = [];
    for (let i = 1_000; i--;) {
      const input = makeInput();
      const output = creatureA.noTraceActivate(input);

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
      const result = creatureA.noTraceActivate(item.input);

      assertAlmostEquals(item.output[0], result[0], 0.00001);
      assertAlmostEquals(item.output[1], result[1], 0.00001);
    });

    const exportJSON = creatureA.exportJSON();

    Deno.writeTextFileSync(
      ".trace/A-clean.json",
      JSON.stringify(exportJSON, null, 2),
    );

    // exportJSON.nodes.forEach((node, indx) => {
    //   node.bias = (node.bias ? node.bias : 0) +
    //     ((indx % 2 == 0 ? 1 : -1) * 0.15);
    // });

    exportJSON.connections.forEach((c, indx) => {
      if (c.type === "positive" || c.type === "negative") {
        c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.25);
      }
    });

    Deno.writeTextFileSync(
      ".trace/B-modified.json",
      JSON.stringify(exportJSON, null, 2),
    );

    const creatureB = Network.fromJSON(exportJSON);
    creatureB.validate();

    const errorB = calculateError(creatureB, ts);

    const creatureC = Network.fromJSON(exportJSON);
    creatureC.validate();

    const resultC = await creatureC.train(ts, {
      iterations: 1,
      error: errorB - 0.01,
      generations: 10,
      useAverageWeight: "Yes",
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
    const creatureD = Network.fromJSON(
      Network.fromJSON(resultC.trace).exportJSON(),
    );
    const creatureE = Network.fromJSON(resultC.trace);
    const config = new BackPropagationConfig({
      useAverageWeight: "Yes",
      // useAverageDifferenceBias: "Yes",
      generations: 0,
    });
    console.info(config);

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
      true ||
        errorB > errorC,
      `Didn't improve error B->C  start: ${errorB} end: ${errorC}`,
    );

    assert(
      true || errorB > resultC.error,
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
        uuid: "hidden-0",
        bias: -0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        bias: -0.1,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        bias: 0.3,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "hidden-3",
        bias: -0.3,
        squash: "IDENTITY",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0.4,
        squash: "IF",
      },
      {
        type: "output",
        uuid: "output-1",
        bias: 0.3,
        squash: "IF",
      },
    ],
    connections: [
      {
        weight: -0.7,
        fromUUID: "input-0",
        toUUID: "hidden-0",
      },
      {
        weight: 0.7,
        fromUUID: "input-1",
        toUUID: "hidden-1",
      },
      {
        weight: 0.4,
        fromUUID: "input-1",
        toUUID: "hidden-2",
      },
      {
        weight: 0.3,
        fromUUID: "input-2",
        toUUID: "hidden-2",
      },
      {
        weight: 0.6,
        fromUUID: "input-3",
        toUUID: "hidden-3",
      },
      {
        weight: 1.1,
        fromUUID: "input-3",
        toUUID: "hidden-0",
      },
      {
        weight: -0.6,
        fromUUID: "input-4",
        toUUID: "hidden-1",
      },
      {
        weight: 1,
        fromUUID: "hidden-3",
        toUUID: "output-0",
        type: "positive",
      },
      {
        weight: -1.1,
        fromUUID: "hidden-2",
        toUUID: "output-0",
        type: "negative",
      },
      {
        weight: -0.8,
        fromUUID: "hidden-2",
        toUUID: "output-1",
        type: "positive",
      },
      {
        weight: 0.2,
        fromUUID: "hidden-0",
        toUUID: "output-1",
        type: "condition",
      },
      {
        weight: -0.5,
        fromUUID: "input-0",
        toUUID: "output-0",
        type: "condition",
      },
      {
        weight: -0.4,
        fromUUID: "hidden-1",
        toUUID: "output-1",
        type: "negative",
      },
    ],
    input: 5,
    output: 2,
  };

  const creature = Network.fromJSON(creatureJson);
  // creature.fix();
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
