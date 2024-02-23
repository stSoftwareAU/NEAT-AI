import { assert } from "https://deno.land/std@0.217.0/assert/mod.ts";
import { emptyDirSync } from "https://deno.land/std@0.217.0/fs/empty_dir.ts";
import { ensureDirSync } from "https://deno.land/std@0.217.0/fs/ensure_dir.ts";
import { Creature } from "../src/Creature.ts";
import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { SynapseTrace } from "../src/architecture/SynapseInterfaces.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("storeTrace", async () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "input", index: 2 },
      {
        type: "output",
        squash: "IF",
        index: 3,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 0.9, type: "condition" },
      { from: 1, to: 3, weight: 1.1, type: "positive" },
      { from: 2, to: 3, weight: 0.95, type: "negative" },
    ],
    input: 3,
    output: 1,
  };

  const ts = [];
  for (let i = 100; i--;) {
    for (let j = 100; j--;) {
      if (i == 50) continue;
      const condition = Math.random() * 2 - 1;
      const positive = Math.random();
      const negative = Math.random();
      const item = {
        input: [condition, positive, negative],
        output: [condition > 0 ? positive : negative],
      };

      ts.push(item);
    }
  }

  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const creaturesDir = ".creatures";
  emptyDirSync(creaturesDir);

  let foundUsed = false;
  let totalCount = 0;

  for (let counter = 10; counter--;) {
    const options: NeatOptions = {
      iterations: 10,
      traceStore: traceDir,
      creatureStore: creaturesDir,
      threads: 1,
      targetError: 0,
    };
    const network = Creature.fromJSON(json);

    await network.evolveDataSet(ts, options);

    for (const dirEntry of Deno.readDirSync(traceDir)) {
      if (dirEntry.name.endsWith(".json")) {
        const json = JSON.parse(
          Deno.readTextFileSync(`${traceDir}/${dirEntry.name}`),
        );
        let usedCount = 0;
        if (json.synapses == undefined) continue;
        json.synapses.forEach((c: SynapseTrace) => {
          if (c.trace && c.trace.used) {
            usedCount++;
          }

          if (
            Number.isFinite(c.trace?.count) &&
            c.trace.count != 0
          ) {
            totalCount++;
          }

          // if (
          //   Number.isFinite(c.trace.totalDeltaWeight) &&
          //   c.trace.totalDeltaWeight != 0
          // ) {
          //   totalDeltaWeightCount++;
          // }
        });

        if (usedCount > 1) {
          foundUsed = true;
        }
      }
    }

    if (foundUsed) break;
  }
  assert(
    foundUsed,
    "Should have traced usage",
  );

  assert(
    totalCount > 0,
    "Should have totalCount",
  );

  // assert(
  //   previousDeltaWeightCount > 0,
  //   "Should have previousDeltaWeightCount",
  // );

  // assert(
  //   totalDeltaWeightCount > 0,
  //   "Should have totalDeltaWeightCount",
  // );
});
