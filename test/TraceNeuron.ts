import { assert } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import type { NeuronTrace } from "../src/architecture/NeuronInterfaces.ts";
import type { NeatOptions } from "../src/config/NeatOptions.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("traceNode", async () => {
  const json: CreatureInternal = {
    neurons: [
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
    synapses: [
      { from: 0, to: 3, weight: 0.9 },
      { from: 3, to: 4, weight: 1.1 },
      { from: 4, to: 5, weight: 0.95 },
      { from: 5, to: 6, weight: 0.85 },
    ],
    input: 3,
    output: 1,
  };
  const network = Creature.fromJSON(json);
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

  let totalBiasCount = 0;

  for (const dirEntry of Deno.readDirSync(traceDir)) {
    if (dirEntry.name.endsWith(".json")) {
      const json = JSON.parse(
        Deno.readTextFileSync(`${traceDir}/${dirEntry.name}`),
      );
      if (!json.neurons) continue;
      json.neurons.forEach((n: NeuronTrace) => {
        if (n.trace) {
          if (
            Number.isFinite(n.trace.totalBias) &&
            n.trace.totalBias != 0
          ) {
            totalBiasCount++;
          }
        }
      });
    }
  }

  assert(
    totalBiasCount > 0,
    "Should have totalBiasValueCount",
  );
});
