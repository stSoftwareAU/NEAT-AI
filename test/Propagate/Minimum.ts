import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import { emptyDirSync } from "https://deno.land/std@0.210.0/fs/empty_dir.ts";
import { Network } from "../../src/architecture/Network.ts";
import { NetworkInternal } from "../../src/architecture/NetworkInterfaces.ts";
import { Costs } from "../../src/Costs.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const creatureJson: NetworkInternal = {
    nodes: [
      { type: "hidden", index: 5, squash: "INVERSE", bias: -0.2 },
      { type: "hidden", index: 6, squash: "ABSOLUTE", bias: -0.1 },
      { type: "hidden", index: 7, squash: "CLIPPED", bias: 0.1 },

      { type: "hidden", index: 8, squash: "RELU", bias: 0.2 },

      {
        type: "output",
        squash: "MINIMUM",
        index: 9,
        bias: 0,
      },
      {
        type: "output",
        squash: "MAXIMUM",
        index: 10,
        bias: 0.3,
      },
    ],
    connections: [
      { from: 0, to: 5, weight: -0.7 },
      { from: 1, to: 5, weight: 0.7 },

      { from: 3, to: 6, weight: 0.6 },
      { from: 4, to: 6, weight: -0.6 },

      { from: 1, to: 7, weight: 0.4 },
      { from: 2, to: 7, weight: 0.3 },
      { from: 3, to: 7, weight: 1.1 },

      { from: 6, to: 8, weight: -1.1 },
      { from: 7, to: 8, weight: -0.8 },

      { from: 8, to: 9, weight: -0.5 },
      { from: 5, to: 9, weight: 1 },

      { from: 8, to: 10, weight: -0.4 },
      { from: 7, to: 10, weight: 0.2 },
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

Deno.test("PropagateMinimum", async () => {
  const creature = makeCreature();

  const ts: { input: number[]; output: number[] }[] = [];
  for (let i = 1_000; i--;) {
    const input = makeInput();
    const output = creature.noTraceActivate(input);

    ts.push({
      input,
      output,
    });
  }

  const traceDir = ".trace";
  emptyDirSync(traceDir);

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
    ".trace/1-clean.json",
    JSON.stringify(exportJSON, null, 2),
  );

  exportJSON.nodes.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 == 0 ? 1 : -1) * 0.05);
  });

  exportJSON.connections.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.05);
  });

  Deno.writeTextFileSync(
    ".trace/2-modified.json",
    JSON.stringify(exportJSON, null, 2),
  );

  for (let attempts = 0; true; attempts++) {
    const creatureB = Network.fromJSON(exportJSON);
    creatureB.validate();

    const errorB = calculateError(creatureB, ts);
    const creatureC = Network.fromJSON(exportJSON);
    creatureC.validate();

    const resultC = await creatureC.train(ts, {
      iterations: 10,
      error: 0,
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

    assert(true || resultC.error >= errorB, `Didn't improve error`);

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

  return error;
}
