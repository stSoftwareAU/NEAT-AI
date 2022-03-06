import { architect } from "../../NEAT-TS/src/architecture/architect.js";
import { assert } from "https://deno.land/std@0.122.0/testing/asserts.ts";

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

  const options = {
    iterations: 100,
    error: 0.002,
    shuffle: true,
    log: 50,
    elitism: 3,
    rate: 0.3,
    momentum: 0.9,
  };
  await network.evolve(ts, options);
  const check = [50, 10];
  const answer = network.activate(check)[0];

  console.log("Answer: ", answer);
  assert(
    answer > 45 && answer < 55,
    "Correct answer is ~51 but was: " + answer,
  );
  // console.log( network.toJSON());
});
