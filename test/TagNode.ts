import { assert } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TagNode", () => {
  const json: NetworkInterface = {
    nodes: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      {
        bias: 0,
        type: "output",
        squash: "MEAN",
        index: 3,
        tags: [
          {
            name: "hello",
            value: "world",
          },
        ],
      },
    ],
    connections: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON(json);

  const json2 = network.externalJSON();

  const network2 = Network.fromJSON(json2);
  const json3 = network2.externalJSON();

  console.info(JSON.stringify(json3, null, 2));

  const tags = json3.nodes[0].tags;
  assert(tags != null, "Should have tags");

  assert(tags.length == 1, "Should have one tag");
});
