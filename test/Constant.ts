import { assert } from "https://deno.land/std@0.156.0/testing/asserts.ts";

import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";

import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { Network } from "../src/architecture/network.js";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Constants", () => {
  const json: NetworkInterface = {
    nodes: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0.5, type: "constant", index: 1 },
      { bias: 0.6, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "MAXIMUM", index: 3 },
    ],
    connections: [
      { weight: 1, from: 0, to: 2 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 1,
    output: 1,
  };
  const network = NetworkUtil.fromJSON(json);
  network.util.validate();

  for (let i = 100; i--;) {
    network.util.modBias();
    network.util.addConnection();
  }

  console.info(JSON.stringify(network.toJSON(), null, 2));
  network.util.validate();
  Network.fromJSON(network.toJSON());
  assert(
    Math.abs(network.nodes[1].bias) - 0.5 < 0.00001,
    "Should NOT have changed the constant node was: " + network.nodes[1].bias,
  );

  assert(
    network.nodes[2].bias > 0.60001 || network.nodes[2].bias < 0.59999,
    "Should have changed the hidden node was: " + network.nodes[2].bias,
  );

  assert(
    network.util.toConnections(1).length === 0,
    "Should not have any inward connections",
  );
});
