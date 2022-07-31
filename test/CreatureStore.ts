import { architect } from "../../NEAT-TS/src/architecture/architect.js";
import { assert } from "https://deno.land/std@0.146.0/testing/asserts.ts";
import { emptyDirSync } from "https://deno.land/std@0.146.0/fs/empty_dir.ts";
import { NeatOptions } from "../src/config/NeatOptions.ts";

window.DEBUG = true;

Deno.test("storePopulation", async () => {
  const network = architect.Random(2, 2, 1);

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
  await network.evolve(ts, options);

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
