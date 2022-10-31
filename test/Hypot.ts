import { assert } from "https://deno.land/std@0.161.0/testing/asserts.ts";

import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Hypot", () => {
  const json: NetworkInterface = {
    nodes: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "HYPOT", index: 3 },
    ],
    connections: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const network = NetworkUtil.fromJSON(json);

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;

    const data = [a, b, c];
    const actual = network.util.activate(data)[0];
    const actual2 = network.util.activate(data)[0];

    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
    const expected = Math.hypot(a, b, c);

    if (Math.abs(expected - actual) >= 0.00001) {
      const actual3 = network.util.activate(data)[0];
      console.info(actual3);
    }
    assert(
      Math.abs(expected - actual) < 0.00001,
      p + ") Expected: " + expected + ", actual: " + actual + ", data: " + data,
    );
  }
});
