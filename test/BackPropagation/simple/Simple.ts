import { assertAlmostEquals } from "@std/assert/almost-equals";
import { fail } from "@std/assert/fail";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { train } from "../../../src/architecture/Training.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const directory = ".test/BackPropagation/simple";

function setup() {
  try {
    Deno.removeSync(directory, { recursive: true });
  } catch (e) {
    const name = (e as { name: string }).name;
    if (name !== "NotFound") {
      console.error(e);
    }
  }

  Deno.mkdirSync(directory, { recursive: true });
}

Deno.test("Simple", () => {
  setup();
  const cleanCreature = makeCreature();

  const td = makeTrainData(cleanCreature);

  const cleanError = calculateError(cleanCreature, td);
  assertAlmostEquals(cleanError, 0, 0.00001, `cleanError: ${cleanError}`);
  const exportJSON = cleanCreature.exportJSON();

  Deno.writeTextFileSync(
    `${directory}/A-clean.json`,
    JSON.stringify(exportJSON, null, 2),
  );

  // exportJSON.neurons.forEach((neuron, indx) => {
  //   neuron.bias = neuron.bias +
  //     ((indx % 2 == 0 ? 1 : -1) * 0.1);
  // });

  exportJSON.synapses.forEach((c, indx) => {
    c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.1);
  });

  const modifiedCreature = Creature.fromJSON(exportJSON);
  Deno.writeTextFileSync(
    `${directory}/B-modified.json`,
    JSON.stringify(exportJSON, null, 2),
  );
  let lastError = calculateError(modifiedCreature, td);
  console.info("Initial error", lastError);

  for (let i = 0; i < 10; i++) {
    Deno.writeTextFileSync(
      `${directory}/C${i}--start.json`,
      JSON.stringify(modifiedCreature.exportJSON(), null, 2),
    );
    const results = train(modifiedCreature, td, {
      targetError: 0.01,
      iterations: 1,
      learningRate: 0.01,
      disableBiasAdjustment: false,
      disableRandomSamples: true,
      // generations: 100,
      disableExponentialScaling: true,
      batchSize: 10000,
      // trainingMutationRate: 1,
      // excludeSquashList: "MINIMUM",
      // excludeSquashList: "CLIPPED,IDENTITY",
    });

    console.log(i, results.error);
    modifiedCreature.validate();
    Creature.fromJSON(results.trace).validate();

    Deno.writeTextFileSync(
      `${directory}/C${i}--trace.json`,
      JSON.stringify(results.trace, null, 2),
    );
    Deno.writeTextFileSync(
      `${directory}/C${i}-end.json`,
      JSON.stringify(modifiedCreature.exportJSON(), null, 2),
    );
    if (results.compact) Creature.fromJSON(results.compact).validate();
    if (results.error > lastError) {
      if (results.error - lastError > 0.005) {
        fail(
          `Error rate was ${results.error}, regression ${
            lastError - results.error
          }`,
        );
      }
    }
    lastError = results.error;
  }
});

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0.1,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "input-2", toUUID: "output-0", weight: -0.3 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeTrainData(creature: Creature) {
  const tdFN = "test/BackPropagation/simple/.td.json";
  try {
    const input = JSON.parse(
      Deno.readTextFileSync(tdFN),
    );
    return input;
  } // deno-lint-ignore no-empty
  catch (_e) {}

  const td: { input: number[]; output: number[] }[] = [];

  for (let i = 999; i--;) {
    const pos = i % 3;
    const input = [
      pos === 0 ? 1 : pos === 1 ? 0 : -1,
      pos === 0 ? 0 : pos === 1 ? -1 : 1,
      pos === 0 ? -1 : pos === 1 ? 1 : 0,
    ];
    const output = creature.activate(input);

    td.push({
      input,
      output,
    });
  }

  Deno.writeTextFileSync(
    tdFN,
    JSON.stringify(td, null, 2),
  );
  return td;
}

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
