import { assert } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import type { NeatOptions } from "../src/config/NeatOptions.ts";
import { Creature } from "../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("checkpointEveryGeneration", async () => {
  const network = new Creature(2, 1, {
    layers: [
      { count: 2 },
    ],
  });

  const ts = [];
  for (let i = 10; i--;) {
    for (let j = 10; j--;) {
      const item = {
        input: new Float32Array([i / 10, j / 10]),
        output: new Float32Array([Math.sqrt((i / 10) ** 2 + (j / 10) ** 2)]),
      };
      ts.push(item);
    }
  }

  const dir = ".creatures-checkpoint-test";
  emptyDirSync(dir);

  const options: NeatOptions = {
    iterations: 3,
    creatureStore: dir,
    checkpointEveryGeneration: true,
    threads: 1,
    populationSize: 5,
    log: 1,
  };

  await network.evolveDataSet(ts, options);

  // Verify that creatures were saved (checkpoint happened)
  let creatureCount = 0;
  // deno-lint-ignore no-sync-fn-in-async-fn
  for (const dirEntry of Deno.readDirSync(dir)) {
    if (dirEntry.name.endsWith(".json")) {
      creatureCount++;
    }
  }

  assert(
    creatureCount > 0,
    `Should have checkpointed creatures, found: ${creatureCount}`,
  );

  // Clean up
  await Deno.remove(dir, { recursive: true });
});

Deno.test("checkpointEveryGeneration disabled", async () => {
  const network = new Creature(2, 1, {
    layers: [
      { count: 2 },
    ],
  });

  const ts = [];
  for (let i = 10; i--;) {
    for (let j = 10; j--;) {
      const item = {
        input: new Float32Array([i / 10, j / 10]),
        output: new Float32Array([Math.sqrt((i / 10) ** 2 + (j / 10) ** 2)]),
      };
      ts.push(item);
    }
  }

  const dir = ".creatures-no-checkpoint-test";
  emptyDirSync(dir);

  const options: NeatOptions = {
    iterations: 3,
    creatureStore: dir,
    checkpointEveryGeneration: false, // Explicitly disabled
    threads: 1,
    populationSize: 5,
    log: 1,
  };

  await network.evolveDataSet(ts, options);

  // With checkpointEveryGeneration disabled, creatures should only be saved at the end
  let creatureCount = 0;
  // deno-lint-ignore no-sync-fn-in-async-fn
  for (const dirEntry of Deno.readDirSync(dir)) {
    if (dirEntry.name.endsWith(".json")) {
      creatureCount++;
    }
  }

  assert(
    creatureCount > 0,
    `Should have saved creatures at end, found: ${creatureCount}`,
  );

  // Clean up
  await Deno.remove(dir, { recursive: true });
});
