import { architect } from "../../NEAT-TS/src/architecture/architect.js";
import { assert } from "https://deno.land/std@0.137.0/testing/asserts.ts";
import { NeatOptions } from "../src/config.ts";

Deno.test("hypotenuse", async () => {
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

  const options: NeatOptions = {
    iterations: 1000,
    error: 0.002,
    log: 50,
    elitism: 3,
  };
  await network.evolve(ts, options);

  const check = [50, 60];
  const answer = network.activate(check)[0];

  const errorPercent = Math.round((1 - answer / 78.1) * 100);
  console.info("Answer", answer, errorPercent);

  assert(
    Math.abs(errorPercent) <= 10,
    "Correct answer is ~78.1 but was: " + answer + " ( " + errorPercent + "% )",
  );
});
