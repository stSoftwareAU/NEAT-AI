import { Network } from "../src/architecture/Network.ts";
import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.165.0/testing/asserts.ts";

import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("CompactSimple", () => {
  const a = new Network(2, 2, {
    layers: [
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
      { count: 1 },
    ],
  });

  a.validate();

  const startNodes = a.nodes.length;
  const startConnections = a.connections.length;

  const input = [0.1, 0.2];
  const startOut = a.noTraceActivate(input);

  console.info(
    "START",
    "nodes",
    startNodes,
    "connections",
    startConnections,
    "output",
    startOut,
  );

  Deno.writeTextFileSync(".a.json", JSON.stringify(a.toJSON(), null, 2));
  const b = a.compact();
  if (b == null) {
    assert(false, "should have compacted the network");
  } else {
    b.validate();
    Deno.writeTextFileSync(".b.json", JSON.stringify(b.toJSON(), null, 2));
    const endNodes = b.nodes.length;
    const endConnections = b.connections.length;

    const endOut = b.noTraceActivate(input);

    console.info(
      "END",
      "nodes",
      endNodes,
      "connections",
      endConnections,
      "output",
      endOut,
    );

    assertAlmostEquals(startOut[0], endOut[0], 0.001);
    assertAlmostEquals(startOut[1], endOut[1], 0.001);
    assert(endNodes < startNodes);
    assert(endConnections < startConnections);

    const c = b.compact();
    assert(c == null);
  }
});

Deno.test("RandomizeCompact", () => {
  const a = new Network(2, 2, {
    layers: [
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1 },
      { count: 1 },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
      { count: 1, squash: "*" },
    ],
  });

  a.validate();

  const startNodes = a.nodes.length;
  const startConnections = a.connections.length;

  const input = [0.1, 0.2];
  const startOut = a.noTraceActivate(input);

  console.info(
    "START",
    "nodes",
    startNodes,
    "connections",
    startConnections,
    "output",
    startOut,
  );

  Deno.writeTextFileSync(".a.json", JSON.stringify(a.toJSON(), null, 2));
  const b = a.compact();
  if (b == null) {
    assert(false, "should have compacted the network");
  } else {
    b.DEBUG = false;
    Deno.writeTextFileSync(".b.json", JSON.stringify(b.toJSON(), null, 2));
    b.DEBUG = true;
    b.validate();
    const endNodes = b.nodes.length;
    const endConnections = b.connections.length;

    const endOut = b.noTraceActivate(input);

    console.info(
      "END",
      "nodes",
      endNodes,
      "connections",
      endConnections,
      "output",
      endOut,
    );

    assertAlmostEquals(startOut[0], endOut[0], 0.002);
    assertAlmostEquals(startOut[1], endOut[1], 0.002);
    assert(endNodes < startNodes);
    assert(endConnections < startConnections);

    const c = b.compact();
    if (c) {
      const d = c.compact();
      assert(d == null);
    }
  }
});

Deno.test("CompactSelf", () => {
  const json: NetworkInterface = {
    nodes: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3 },
      { type: "hidden", squash: "LOGISTIC", bias: -0.5, index: 4 },
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 5 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 6 },
      { type: "hidden", squash: "MEAN", bias: -0.25, index: 7 },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 8,
        bias: 0,
      },
    ],
    connections: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 3, to: 8, weight: 0.2, type: "positive" },
      { from: 0, to: 8, weight: 0.25, type: "positive" },
      { from: 3, to: 4, weight: 0.3, type: "condition" },
      { from: 2, to: 5, weight: 0.4, type: "negative" },
      { from: 1, to: 6, weight: 0.5, type: "negative" },
      { from: 4, to: 7, weight: 0.7, type: "negative" },
      { from: 5, to: 7, weight: 0.7, type: "negative" },
      { from: 6, to: 7, weight: 0.7, type: "negative" },
      { from: 7, to: 7, weight: 0.7, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const a = Network.fromJSON(json);

  a.validate();

  const startNodes = a.nodes.length;
  const startConnections = a.connections.length;

  const input = [0.1, 0.2];
  const aOut = a.noTraceActivate(input);

  console.info(
    "START",
    "nodes",
    startNodes,
    "connections",
    startConnections,
    "output",
    aOut,
  );

  Deno.writeTextFileSync(".a.json", JSON.stringify(a.toJSON(), null, 2));
  // a.util.fix();
  // Deno.writeTextFileSync(".a2.json", JSON.stringify(a.toJSON(), null, 2));

  const aOut2 = a.noTraceActivate(input);

  assertAlmostEquals(aOut[0], aOut2[0], 0.001);
  const b = a.compact();
  if (b == null) {
    assert(false, "should have compacted the network");
  } else {
    b.validate();
    Deno.writeTextFileSync(".b.json", JSON.stringify(b.toJSON(), null, 2));
    const endNodes = b.nodes.length;
    const endConnections = b.connections.length;

    const endOut = b.noTraceActivate(input);

    console.info(
      "END",
      "nodes",
      endNodes,
      "connections",
      endConnections,
      "output",
      endOut,
    );

    assertAlmostEquals(aOut[0], endOut[0], 0.001);
    assert(endNodes < startNodes);
    assert(endConnections < startConnections);

    const c = b.compact();
    assert(c == null);
  }
});
