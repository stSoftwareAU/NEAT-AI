import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.212.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.212.0/fs/ensure_dir.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { train } from "../../src/architecture/Training.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("PropagateWeightsIF", async () => {
  const creatureA = makeCreature();
  for (let attempts = 0; true; attempts++) {
    const ts: { input: number[]; output: number[] }[] = [];
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

    exportJSON.synapses.forEach((c, indx) => {
      if (c.type === "positive" || c.type === "negative") {
        c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.25);
      }
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
      iterations: 1000,
      targetError: errorB - 0.01,
      generations: 10,
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

    console.log(
      `Error: B: ${errorB}, C: ${errorC}`,
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

Deno.test("PropagateBiasIF", async () => {
  const creatureA = makeCreature();
  for (let attempts = 0; true; attempts++) {
    const ts: { input: number[]; output: number[] }[] = [];
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
      if (node.type == "hidden") {
        node.bias = (node.bias ? node.bias : 0) +
          ((indx % 2 == 0 ? 1 : -1) * 0.25);
      }
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
      iterations: 1000,
      targetError: errorB - 0.01,
      generations: 10,
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

    console.log(
      `Error: B: ${errorB}, C: ${errorC}`,
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

    const aHidden1 = creatureA.neurons.find((node) => node.uuid === "hidden-1");
    const bHidden1 = creatureB.neurons.find((node) => node.uuid === "hidden-1");
    const cHidden1 = creatureC.neurons.find((node) => node.uuid === "hidden-1");

    const diffAB = Math.abs((aHidden1?.bias ?? 0) - (bHidden1?.bias ?? 0));
    const diffAC = Math.abs((aHidden1?.bias ?? 0) - (cHidden1?.bias ?? 0));

    assert(diffAC < diffAB, `diffAC ${diffAC} < diffAB ${diffAB}`);

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
    synapses: [
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
