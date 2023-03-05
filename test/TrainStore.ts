import { assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { emptyDirSync } from "https://deno.land/std@0.177.0/fs/empty_dir.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("storeTrain", async () => {
  const json: NetworkInternal = {
    nodes: [
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
    connections: [
      { from: 0, to: 3, weight: 0.9, type: "condition" },
      { from: 1, to: 3, weight: 1.1, type: "positive" },
      { from: 2, to: 3, weight: 0.95, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON(json);

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

  const trainDir = ".train";
  emptyDirSync(trainDir);
  const creaturesDir = ".creatures";
  emptyDirSync(creaturesDir);

  const options: NeatOptions = {
    iterations: 10,
    trainStore: trainDir,
    creatureStore: creaturesDir,
    threads: 1,
    error: 0,
  };
  await network.evolveDataSet(ts, options);

  let foundUsed = false;

  for (const dirEntry of Deno.readDirSync(trainDir)) {
    if (dirEntry.name.endsWith(".json")) {
      const json = JSON.parse(
        Deno.readTextFileSync(`${trainDir}/${dirEntry.name}`),
      );
      json.connections.forEach((c: { trace: { used: boolean } }) => {
        if (c.trace && c.trace.used) {
          foundUsed = true;
        }
      });
    }
  }
  assert(
    foundUsed,
    "Should have traced usage",
  );
});
