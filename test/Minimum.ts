import { assert } from "https://deno.land/std@0.140.0/testing/asserts.ts";

import { Network } from "../../NEAT-TS/src/architecture/network.js";

Deno.test("Minimum", () => {
  const json = {
    nodes: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "MINIMUM", index: 3 },
    ],
    connections: [
      { weight: 0, from: 0, to: 3, gater: null },
      { weight: 0, from: 1, to: 3, gater: null },
      { weight: 0, from: 2, to: 3, gater: null },
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON(json);

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const actual = network.activate([a, b, c])[0];

    const expected = Math.min(a, b, c);
    assert(
      Math.abs(expected - actual) < 0.00001,
      "Expected: " + expected + ", actual: " + actual,
    );
  }
});
