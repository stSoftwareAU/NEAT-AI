import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { assert } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

Deno.test("useUUIDinsteadOfPosition", () => {
  const creature: NetworkInterface = {
    uuid: "60d9fde3-465a-4022-956a-c425fc8e62cc",
    nodes: [
      {
        bias: 0,
        index: 5,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        bias: 0.1,
        index: 6,
        type: "output",
        squash: "IDENTITY",
      },
      {
        bias: 0.2,
        index: 7,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    connections: [
      {
        weight: -0.1,
        from: 1,
        to: 5,
      },
      {
        weight: 0.2,
        from: 4,
        to: 7,
      },
      {
        weight: 0.1,
        from: 5,
        to: 6,
      },
    ],
    input: 5,
    output: 2,
    tags: [
      { name: "hello", value: "world" },
    ],
    score: -0.1111,
  };

  const n1 = Network.fromJSON(creature);
  const exported = n1.externalJSON();
  const j1 = JSON.stringify(exported, null, 2);

  console.info(j1);

  exported.nodes.forEach((n) => {
    console.info(n);
    const indx = n.index;
    assert(!Number.isFinite(indx), `should NOT have an index ${indx}`);
  });
});
