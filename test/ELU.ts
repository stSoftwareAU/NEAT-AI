import { assert } from "https://deno.land/std@0.211.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";

import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import { ELU } from "../src/methods/activations/types/ELU.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ELU", () => {
  const json: NetworkInternal = {
    nodes: [
      { bias: 0, type: "output", squash: "ELU", index: 3 },
    ],
    connections: [
      { weight: 1, from: 0, to: 1 },
    ],
    input: 1,
    output: 1,
  };
  const network = Network.fromJSON(json);
  const activation = new ELU();
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 4 - 2;

    const data = [a];
    const actual = network.activate(data)[0];
    const actual2 = network.activate(data)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = activation.squash(a);

    if (Math.abs(expected - actual) >= 0.00001) {
      const actual3 = network.activate(data)[0];
      console.info(actual3);
    }
    assert(
      Math.abs(expected - actual) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual + ", data: " + data,
    );
  }
});
