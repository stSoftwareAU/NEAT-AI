import { assert } from "https://deno.land/std@0.194.0/testing/asserts.ts";
import { emptyDirSync } from "https://deno.land/std@0.194.0/fs/empty_dir.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import { ConnectionTrace } from "../src/architecture/ConnectionInterfaces.ts";
import { TrainOptions } from "../src/config/TrainOptions.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ifPropagation", () => {
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
  emptyDirSync(traceDir);

  let foundUsed = false;

  const options: TrainOptions = {
    iterations: 1,
    error: 0,
  };
  const network = Network.fromJSON(json);

  const result = network.train(ts, options);

  const traceJson = result.trace;
  Deno.writeTextFileSync(
    ".trace/ifPropagation.json",
    JSON.stringify(traceJson, null, 2),
  );
  let usedCount = 0;
  traceJson.connections.forEach((c: ConnectionTrace) => {
    if (c.trace && c.trace.used) {
      usedCount++;
    }
  });

  if (usedCount > 1) {
    foundUsed = true;
  }

  assert(
    foundUsed,
    "Should have traced usage",
  );

  traceJson.nodes.forEach((n) => {
    assert(Math.abs(n.bias ? n.bias : 0) < 1, `Invalid bias ${n.bias}`);
  });
});
