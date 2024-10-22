import { assertAlmostEquals } from "@std/assert/almost-equals";
import { fail } from "@std/assert/fail";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { train } from "../../../src/architecture/Training.ts";
import { Costs } from "../../../src/Costs.ts";
import { Creature } from "../../../src/Creature.ts";
import { assert } from "@std/assert/assert";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const directory = ".test/BackPropagation/biasIdentity";

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

  exportJSON.neurons.forEach((neuron, indx) => {
    neuron.bias = neuron.bias +
      ((indx % 2 == 0 ? 1 : -1) * 0.1);
  });

  // exportJSON.synapses.forEach((c, indx) => {
  //   c.weight = c.weight + ((indx % 2 == 0 ? 1 : -1) * 0.1);
  // });

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
      learningRate: 1,
      disableWeightAdjustment: true,
      disableRandomSamples: true,
      batchSize: 100,
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
        type: "hidden",
        squash: "IDENTITY",
        uuid: "hidden-0",
        bias: -0.1,
      },
      {
        type: "hidden",
        squash: "IDENTITY",
        uuid: "hidden-1",
        bias: 0.2,
      },
      {
        type: "hidden",
        squash: "IDENTITY",
        uuid: "hidden-2",
        bias: -0.2,
      },
      {
        type: "hidden",
        squash: "IDENTITY",
        uuid: "hidden-3",
        bias: 0.3,
      },
      {
        type: "hidden",
        squash: "IDENTITY",
        uuid: "hidden-4",
        bias: -0.3,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0.1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0.1,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "input-2", toUUID: "hidden-3", weight: -0.4 },
      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: 0.4 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: -0.5 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-4", toUUID: "output-1", weight: -0.6 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-0", toUUID: "hidden-3", weight: 0.14 },
      { fromUUID: "hidden-1", toUUID: "hidden-3", weight: -0.11 },
      { fromUUID: "hidden-2", toUUID: "hidden-3", weight: 0.12 },
      { fromUUID: "hidden-3", toUUID: "output-1", weight: -0.16 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.13 },
      { fromUUID: "input-0", toUUID: "output-1", weight: -0.18 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 0.12 },
      { fromUUID: "input-2", toUUID: "output-1", weight: -0.15 },
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.21 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.22 },
      { fromUUID: "hidden-0", toUUID: "hidden-2", weight: -0.3 },

      { fromUUID: "input-0", toUUID: "hidden-2", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: -0.3 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeTrainData(creature: Creature) {
  const tdFN = "test/BackPropagation/biasIdentity/.td.json";
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
  let totalError = 0;
  const count = json.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = json[i];
    assert(data.output.length === 2, `output.length: ${data.output.length}`);
    const output = creature.activate(data.input, false);
    assert(output.length === 2, `output.length: ${output.length}`);
    assert(Number.isFinite(output[0]), `0: ${output[0]}`);
    assert(Number.isFinite(output[1]), `1: ${output[1]}`);
    if (998 === i) {
      console.info("output", output);
    }
    const error = mse.calculate(data.output, output);
    assert(Number.isFinite(error), `${i}) error: ${error}`);
    totalError += error;
  }

  const averageError = totalError / count;
  assert(Number.isFinite(averageError), `averageError: ${averageError}`);
  return averageError;
}

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
