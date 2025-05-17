import { assert } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

Deno.test("TraceDir", () => {
  // const directory = ".test/TraceDir";
  // // deno-lint-ignore no-sync-fn-in-async-fn
  // Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.42,
        type: "output",
        squash: Mish.NAME,
        uuid: "output-0",
      },
      {
        bias: -0.42,
        type: "output",
        squash: TANH.NAME,
        uuid: "output-1",
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.1,
      },
      {
        fromUUID: "input-1",
        toUUID: "output-1",
        weight: -0.2,
      },
      {
        fromUUID: "input-2",
        toUUID: "output-0",
        weight: 0.3,
      },
    ],
    input: 3,
    output: 2,
  };
  const complex = Creature.fromJSON(json);
  complex.validate();
  const config = createNeatConfig({ sparseRatio: 1 });

  const dataSet: DataRecordInterface[] = [];

  for (let i = 999; i--;) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;
    const input = [
      a,
      b,
      c,
    ];
    dataSet.push({
      input,
      output: [a * 0.42, b + c * -0.42],
    });
  }

  const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak);

  const result = complex.traceDir(dataSetDir, config);

  assert(result.score);
  const traced = complex.traceJSON();
  assert(traced);

  assert(traced.neurons.length === 2);
  assert(traced.synapses.length === 3);
  assert(traced.neurons[0].type === "output");
  assert(traced.neurons[0].trace);

  assert(traced.neurons[1].type === "output");
  assert(traced.neurons[1].trace);

  assert(traced.synapses[0].trace);
  assert(traced.synapses[1].trace);
  assert(traced.synapses[2].trace);
});
