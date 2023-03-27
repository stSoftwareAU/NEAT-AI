import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.181.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("generateUUID", () => {
  const creature: NetworkInternal = {
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

  n1.nodes.forEach((n) => {
    assert(n.uuid, "Must have a UUID");
  });

  const j1 = n1.exportJSON();
  const n2 = Network.fromJSON(j1);

  for (let i = 0; i < n1.nodes.length; i++) {
    assertEquals(n1.nodes[i].uuid, n2.nodes[i].uuid);
  }
});
