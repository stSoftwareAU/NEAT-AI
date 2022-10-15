import { Network } from "../src/architecture/network.js";
import { assertAlmostEquals } from "https://deno.land/std@0.159.0/testing/asserts.ts";
import { assert } from "https://deno.land/std@0.159.0/_util/assert.ts";

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

  a.util.validate();

  const startNodes = a.nodes.length;
  const startConnections = a.connections.length;

  const input = [0.1, 0.2];
  const startOut = a.noTraceActivate(input);

  console.info(
    "SATRT",
    "nodes",
    startNodes,
    "connections",
    startConnections,
    "output",
    startOut,
  );

  Deno.writeTextFileSync(".a.json", JSON.stringify(a.toJSON(), null, 2));
  const b = a.util.compact();
  if (b == null) {
    assert(false, "should have compacted the network");
  } else {
    b.util.validate();
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

    const c = b.util.compact();
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

  a.util.validate();

  const startNodes = a.nodes.length;
  const startConnections = a.connections.length;

  const input = [0.1, 0.2];
  const startOut = a.noTraceActivate(input);

  console.info(
    "SATRT",
    "nodes",
    startNodes,
    "connections",
    startConnections,
    "output",
    startOut,
  );

  Deno.writeTextFileSync(".a.json", JSON.stringify(a.toJSON(), null, 2));
  const b = a.util.compact();
  if (b == null) {
    assert(false, "should have compacted the network");
  } else {
    b.util.DEBUG = false;
    Deno.writeTextFileSync(".b.json", JSON.stringify(b.toJSON(), null, 2));
    b.util.DEBUG = true;
    b.util.validate();
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

    const c = b.util.compact();
    if (c) {
      const d = c.util.compact();
      assert(d == null);
    }
  }
});
