import { assert } from "https://deno.land/std@0.221.0/assert/mod.ts";
import { emptyDirSync } from "https://deno.land/std@0.221.0/fs/empty_dir.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";
import { Creature } from "../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("storePopulation", async () => {
  const network = new Creature(2, 1, {
    layers: [
      { count: 2 },
    ],
  });
  const ts = [];
  for (let i = 100; i--;) {
    for (let j = 100; j--;) {
      if (i == 50) continue;
      const item = {
        input: [i, j],
        output: [Math.sqrt(i * i + j * j)],
      };

      ts.push(item);
    }
  }

  const dir = ".creatures";
  emptyDirSync(".creatures");
  const options: NeatOptions = {
    iterations: 10,
    creatureStore: dir,
    threads: 1,
  };
  await network.evolveDataSet(ts, options);

  let creatureCount = 0;
  for (const dirEntry of Deno.readDirSync(dir)) {
    if (dirEntry.name.endsWith(".json")) {
      creatureCount++;
    }
  }
  assert(
    creatureCount > 1,
    "Should have stored the creatures was: " + creatureCount,
  );
});
