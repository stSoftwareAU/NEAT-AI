import { assert } from "@std/assert";
import { emptyDirSync } from "@std/fs";
import type { NeatOptions } from "../src/config/NeatOptions.ts";
import { Creature } from "../src/Creature.ts";
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

Deno.test("storePopulation", async () => {
  const network = new Creature(2, 1, {
    layers: [
      { count: 2 },
    ],
  });
  const ts = [];
  for (let i = 100; i--;) {
    for (let j = 100; j--;) {
      if (i === 50) continue;
      const item = {
        input: new Float32Array([i, j]),
        output: new Float32Array([Math.sqrt(i * i + j * j)]),
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
  // deno-lint-ignore no-sync-fn-in-async-fn
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
