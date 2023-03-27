import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.181.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("No squash", () => {
  const json: NetworkInternal = {
    nodes: [
      { bias: 0.5, type: "constant", index: 1 },
      { bias: 0, type: "output", squash: "IDENTITY", index: 2 },
    ],
    connections: [
      { weight: 1, from: 1, to: 2 },
    ],
    input: 1,
    output: 1,
  };
  const network = Network.fromJSON(json);
  network.validate();
  network.fix();
  network.validate();

  const value = network.noTraceActivate([Math.random()])[0];

  assertAlmostEquals(value, 0.5, 0.00001);

  const value2 = network.activate([Math.random()])[0];

  assertAlmostEquals(value2, 0.5, 0.00001);

  console.info(JSON.stringify(network.exportJSON(), null, 2));
});

Deno.test("Constants", () => {
  const json: NetworkInternal = {
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
  const network = Network.fromJSON(json);
  network.validate();

  for (let i = 100; i--;) {
    network.modBias();
    network.addConnection();
  }

  console.info(JSON.stringify(network.exportJSON(), null, 2));
  network.validate();
  Network.fromJSON(network.exportJSON());
  assert(
    Math.abs(network.nodes[1].bias ? network.nodes[1].bias : 0) - 0.5 < 0.00001,
    "Should NOT have changed the constant node was: " + network.nodes[1].bias,
  );

  assert(
    (network.nodes[2].bias ? network.nodes[2].bias : 0) > 0.60001 ||
      (network.nodes[2].bias ? network.nodes[2].bias : 0) < 0.59999,
    "Should have changed the hidden node was: " + network.nodes[2].bias,
  );

  assert(
    network.toConnections(1).length === 0,
    "Should not have any inward connections",
  );
});
