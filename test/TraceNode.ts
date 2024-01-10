import { assert } from "https://deno.land/std@0.211.0/assert/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.211.0/fs/ensure_dir.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import { NodeTrace } from "../src/architecture/NodeInterfaces.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("traceNode", async () => {
  const json: NetworkInternal = {
    nodes: [
      { type: "hidden", index: 3, squash: "IDENTITY" },
      { type: "hidden", index: 4, squash: "IDENTITY" },
      { type: "hidden", index: 5, squash: "IDENTITY" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 6,
        bias: 0,
      },
    ],
    connections: [
      { from: 0, to: 3, weight: 0.9 },
      { from: 3, to: 4, weight: 1.1 },
      { from: 4, to: 5, weight: 0.95 },
      { from: 5, to: 6, weight: 0.85 },
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON(json);
  network.validate();

  const ts = [];
  for (let i = 100; i--;) {
    const a = Math.random() * 2 - 1;
    const b = Math.random();
    const c = Math.random();
    const item = {
      input: [a, b, c],
      output: [a * b * c + 0.1],
    };

    ts.push(item);
  }

  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const creaturesDir = ".creatures";
  ensureDirSync(creaturesDir);

  const options: NeatOptions = {
    iterations: 10,
    traceStore: traceDir,
    creatureStore: creaturesDir,
    threads: 1,
    targetError: 0,
  };
  await network.evolveDataSet(ts, options);

  // let errorResponsibilityCount = 0;
  // let errorProjectedCount = 0;
  // let batchSizeCount = 0;
  let totalValueCount = 0;

  for (const dirEntry of Deno.readDirSync(traceDir)) {
    if (dirEntry.name.endsWith(".json")) {
      const json = JSON.parse(
        Deno.readTextFileSync(`${traceDir}/${dirEntry.name}`),
      );
      if (!json.nodes) continue;
      json.nodes.forEach((n: NodeTrace) => {
        if (n.trace) {
          // if (
          //   Number.isFinite(n.trace.errorResponsibility) &&
          //   n.trace.errorResponsibility != 0
          // ) {
          //   errorResponsibilityCount++;
          // }

          // if (
          //   Number.isFinite(n.trace.errorProjected) &&
          //   n.trace.errorProjected != 0
          // ) {
          //   errorProjectedCount++;
          // }

          // if (
          //   Number.isFinite(n.trace.batchSize) &&
          //   n.trace.batchSize != 0
          // ) {
          //   batchSizeCount++;
          // }

          if (
            Number.isFinite(n.trace.totalValue) &&
            n.trace.totalValue != 0
          ) {
            totalValueCount++;
          }
        }
      });
    }
  }
  // assert(
  //   batchSizeCount > 0,
  //   "Should have batchSizeCount",
  // );

  // assert(
  //   errorProjectedCount > 0,
  //   "Should have errorProjectedCount",
  // );

  assert(
    totalValueCount > 0,
    "Should have totalBiasValueCount",
  );
});
