import { assert } from "https://deno.land/std@0.216.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.216.0/fs/ensure_dir.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("PropagateMaximumSimple", () => {
  const creatureA = makeCreature();

  const ts: { input: number[]; output: number[] }[] = []; //JSON.parse( Deno.readTextFileSync(".trace/data.json"));
  const inputs = makeInputs();
  for (let i = inputs.length; i--;) {
    const input = inputs[i];
    const output = creatureA.activate(input);

    ts.push({
      input,
      output,
    });
  }

  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const exportJSON = creatureA.exportJSON();

  Deno.writeTextFileSync(
    ".trace/A-clean.json",
    JSON.stringify(exportJSON, null, 2),
  );

  Deno.writeTextFileSync(
    ".trace/data.json",
    JSON.stringify(ts, null, 2),
  );

  exportJSON.neurons.forEach((node, indx) => {
    node.bias = (node.bias ? node.bias : 0) +
      ((indx % 2 == 0 ? 1 : -1) * 0.1);
  });

  exportJSON.synapses.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.1);
  });

  Deno.writeTextFileSync(
    ".trace/B-modified.json",
    JSON.stringify(exportJSON, null, 2),
  );

  const creatureB = Creature.fromJSON(exportJSON);
  creatureB.validate();

  const errorB = calculateError(creatureB, ts);

  const creatureC = Creature.fromJSON(creatureB.exportJSON());
  const config = new BackPropagationConfig({
    // disableRandomList: true,
    // useAverageValuePerActivation: true,
    // useAverageValuePerActivation: false,
    // useAverageDifferenceBias: "Yes",
    generations: 10,
    learningRate: 0.1,
  });
  console.info(config);

  ts.forEach((item) => {
    creatureC.activateAndTrace(item.input, false);
    creatureC.propagate(item.output, config);
  });

  Deno.writeTextFileSync(
    ".trace/C-trace.json",
    JSON.stringify(creatureC.traceJSON(), null, 2),
  );

  creatureC.propagateUpdate(config);

  const creatureD = Creature.fromJSON(creatureC.exportJSON());

  Deno.writeTextFileSync(
    ".trace/D-creature.json",
    JSON.stringify(creatureD.exportJSON(), null, 2),
  );

  const errorD = calculateError(creatureD, ts);

  assert(errorD < errorB, `errorB: ${errorB} errorD: ${errorD}`);
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
        uuid: "hidden-A",
        bias: -0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "hidden-B",
        bias: 0.2,
        squash: "IDENTITY",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0.4,
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: -0.7,
        fromUUID: "input-0",
        toUUID: "hidden-A",
      },
      {
        weight: 0.6,
        fromUUID: "input-1",
        toUUID: "hidden-B",
      },
      {
        weight: 1.1,
        fromUUID: "hidden-B",
        toUUID: "output-0",
      },
      {
        weight: 1,
        fromUUID: "hidden-A",
        toUUID: "output-0",
      },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  return creature;
}

function makeInputs() {
  return [[
    -1.0872604383501168,
    -0.8268735162527403,
  ], [
    -0.1723482305995705,
    1.2160054519690178,
  ], [
    1.4862354067623782,
    0.8116785981628674,
  ], [
    -0.9157730197189871,
    0.5891727007061016,
  ], [
    -0.10137142319323056,
    -1.2920101294830812,
  ], [
    1.019991407993849,
    -0.14241360114958224,
  ], [
    0.23507530363345297,
    0.32011073342751684,
  ], [
    -0.20388816049116487,
    -0.7676579490553483,
  ], [
    0.13433749354515911,
    0.21621614249997623,
  ], [
    -0.19487698233316264,
    -0.8857423831539168,
  ]];
}
