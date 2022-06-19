import { assert } from "https://deno.land/std@0.140.0/testing/asserts.ts";

import { Network } from "../../NEAT-TS/src/architecture/network.js";

Deno.test("Missing Info", () => {
  const json={
    nodes: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: -4.5026571628313095, type: "output", squash: "LOGISTIC", index: 3 }
    ],
    connections: [
      { weight: 2.4398574182756523, from: 2, to: 3, gater: null },
      { weight: 1.6061653843217425, from: 1, to: 3, gater: null },
      { weight: 4.818452007338341, from: 0, to: 3, gater: null }
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON( json);

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const flag = Math.random() > 0.5 ? 1 : 0;

    const expected = flag > 0 ? a : b;

    const actual = network.activate([a, flag, b])[0];

    const diff=Math.abs( expected-actual);
    assert( diff < 0.00001, "If/Else didn't work " + diff);

  }

});
