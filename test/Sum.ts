import { assertAlmostEquals } from "https://deno.land/std@0.160.0/testing/asserts.ts";

import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { Upgrade } from "../src/reconstruct/Upgrade.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Sum", () => {
  const json: NetworkInterface = {
    nodes: [
      { bias: 0, type: "output", squash: "SUM", index: 3 },
    ],
    connections: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const json2 = Upgrade.correct(json);
  const network = NetworkUtil.fromJSON(json2);

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const data = [a, b, c];
    const actual = network.util.activate(data)[0];

    assertAlmostEquals(actual, a + b + c, 0.00001);
  }
});
