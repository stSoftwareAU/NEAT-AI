import { assertAlmostEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";

import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import { Upgrade } from "../src/reconstruct/Upgrade.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("correctExport", () => {
  const json: NetworkInternal = {
    nodes: [
      { bias: 0, type: "output", squash: "IDENTITY", index: 3 },
    ],
    connections: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const json2 = Upgrade.correct(Network.fromJSON(json).exportJSON(), 5);
  const network = Network.fromJSON(json2);

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const data = [a, b, c, a + b, b + c];
    const actual = network.activate(data)[0];

    assertAlmostEquals(actual, a + b + c, 0.00001);
  }
});
