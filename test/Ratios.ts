import { assert } from "@std/assert";
import type { DataRecordInterface } from "../src/architecture/DataSet.ts";
import type { NeatOptions } from "../src/config/NeatOptions.ts";
import { Creature } from "../src/Creature.ts";
import { initWasmForTests } from "./_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("hypotenuse", async () => {
  await initWasmForTests();
  const ts: DataRecordInterface[] = [];
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

  const options: NeatOptions = {
    iterations: 100,
    targetError: 0.002,
    log: 50,
    elitism: 3,
    enableRepetitiveTraining: true,
  };

  let errorPercent = 0;
  let answer = 0;
  for (let attempts = 0; attempts < 240; attempts++) {
    const network = new Creature(2, 1, {
      layers: [
        { count: 2 },
      ],
    });

    // deno-lint-ignore no-await-in-loop
    await network.evolveDataSet(ts, options);

    const check = new Float32Array([50, 60]);
    answer = network.activate(check)[0];

    errorPercent = Math.round((1 - answer / 78.1) * 100);

    if (Math.abs(errorPercent) < 10) break;
  }

  assert(
    Math.abs(errorPercent) <= 10,
    "Correct answer is ~78.1 but was: " + answer + " ( " + errorPercent + "% )",
  );
});
