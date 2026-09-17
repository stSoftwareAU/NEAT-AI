import { assert } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Creature } from "@creature";
import { initWasmForTests } from "../_initWasm.ts";
import {
  buildHypotenuseDataSet,
  HYPOTENUSE_HOLD_OUT,
} from "./_hypotenuseDataSet.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Evolution is stochastic, so a single attempt can land on a poor topology.
 * The retry budget is what keeps the suite deterministic; it is not a cost
 * knob, but it does bound the worst case. At the measured per-attempt success
 * rate (~75%) even ten attempts would make a spurious failure a 1-in-a-million
 * event, so 40 leaves enormous headroom while capping a pathological run at a
 * couple of minutes instead of hours (Issue #4026).
 */
const MAX_ATTEMPTS = 40;

Deno.test("hypotenuse", async () => {
  await initWasmForTests();
  // Sampled every 5 on both axes, with the probe row held out, so the
  // assertion below is still a generalisation check — see
  // `_hypotenuseDataSet.ts` for why the grid is no longer dense.
  const ts = buildHypotenuseDataSet();

  const options: NeatOptions = {
    iterations: 100,
    targetError: 0.002,
    log: 50,
    elitism: 3,
    threads: 1, // Avoid worker init in test; multi-threaded evolution is tested elsewhere.
  };

  let errorPercent = 0;
  let answer = 0;
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
    const network = new Creature(2, 1, {
      layers: [
        { count: 2 },
      ],
    });

    // deno-lint-ignore no-await-in-loop
    await network.evolveDataSet(ts, options);

    const check = new Float32Array([HYPOTENUSE_HOLD_OUT, 60]);
    answer = network.activate(check)[0];

    errorPercent = Math.round((1 - answer / 78.1) * 100);

    if (Math.abs(errorPercent) < 10) break;
  }

  assert(
    Math.abs(errorPercent) <= 10,
    "Correct answer is ~78.1 but was: " + answer + " ( " + errorPercent + "% )",
  );
});
