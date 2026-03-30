import { assert, assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { Costs } from "@costs";
import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("MINIMUM activation: training reduces error after bias and weight perturbation", async () => {
  await initWasmForTests();
  for (let attempts = 0; true; attempts++) {
    const creature = makeCreature();

    const ts: DataRecordInterface[] = [];
    for (let i = 1_000; i--;) {
      const input = makeInput();
      const output = creature.activate(new Float32Array(input), false);

      ts.push({
        input: new Float32Array(input),
        output: new Float32Array(Array.from(output)),
      });
    }

    ts.forEach((item) => {
      const result = creature.activate(
        new Float32Array(item.input),
        false,
      );

      assertAlmostEquals(item.output[0], result[0], 0.00001);
      assertAlmostEquals(item.output[1], result[1], 0.00001);
    });

    const exportJSON = creature.exportJSON();

    exportJSON.neurons.forEach((neuron, indx) => {
      neuron.bias = neuron.bias +
        ((indx % 2 === 0 ? 1 : -1) * 0.1);
    });

    exportJSON.synapses.forEach((c, indx) => {
      c.weight = c.weight + ((indx % 2 === 0 ? 1 : -1) * 0.1);
    });

    const creatureB = Creature.fromJSON(exportJSON);
    creatureB.validate();

    const errorB = calculateError(creatureB, ts);

    const creatureC = Creature.fromJSON(exportJSON);
    creatureC.validate();

    const to: TrainOptions = {
      iterations: 1000,
      targetError: errorB - 0.001,
      disableRandomSamples: true,
    };

    const resultC = train(creatureC, ts, to);

    if (attempts < 24) {
      if (errorB <= resultC.error) {
        continue;
      }
    }

    const errorC = calculateError(creatureC, ts);

    assert(
      errorB > errorC,
      `Didn't improve error B->C  start: ${errorB} end: ${errorC}`,
    );

    assert(
      errorB > resultC.error,
      `Didn't improve error B->C *reported*  start: ${errorB} end: ${resultC.error}`,
    );

    break;
  }
});

function calculateError(
  creature: Creature,
  json: DataRecordInterface[],
) {
  let error = 0;
  const count = json.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = json[i];
    const output = creature.activate(new Float32Array(data.input), false);
    error += mse.calculate(
      new Float32Array(data.output),
      new Float32Array(output),
    );
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
