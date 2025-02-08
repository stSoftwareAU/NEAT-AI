import { assert, assertAlmostEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { Fitness } from "../../src/architecture/Fitness.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";

Deno.test("100%", async () => {
  const directory = ".test/optimize/simplify/TAN";
  // deno-lint-ignore no-sync-fn-in-async-fn
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.42,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
      },
      {
        bias: -0.42,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-1",
      },
    ],
    synapses: [],
    input: 3,
    output: 2,
  };
  const complex = Creature.fromJSON(json);
  complex.validate();
  const config = createNeatConfig({});

  const dataSet: DataRecordInterface[] = [];

  for (let i = 999; i--;) {
    const input = [
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ];
    dataSet.push({
      input,
      output: [0.42, -0.42],
    });
  }

  const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak);
  const workers = [
    new WorkerHandler(dataSetDir, config.costName, true),
  ];
  const fitness = new Fitness(
    workers,
    config.costOfGrowth,
    config.feedbackLoop,
  );

  await fitness.calculate([complex]);

  assert(complex.score);
  assertAlmostEquals(complex.score, 1);
});
