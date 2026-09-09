/**
 * Tests for SerialChains.ts
 *
 * Issue #3972 — a serial chain is a run of consecutive depth levels holding
 * exactly one neuron each, connected end to end. It is the structure that makes
 * a zero derivative unrecoverable, because there is no depth-parallel route
 * around it.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  findSerialChains,
  longestSerialChain,
} from "@propagate/SerialChains.ts";

Deno.test("SerialChains - a single-file tail is reported end to end", () => {
  // input → a → b → c → output, with a second input joining at `a` so depth 1
  // is still single-occupancy.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "HARD_TANH", bias: 0 },
      { type: "hidden", uuid: "c", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "input-1", toUUID: "a", weight: 1 },
      { fromUUID: "a", toUUID: "b", weight: 1 },
      { fromUUID: "b", toUUID: "c", weight: 1 },
      { fromUUID: "c", toUUID: "output-0", weight: 1 },
    ],
  });

  const chains = findSerialChains(creature);
  assertEquals(chains.length, 1);
  assertEquals(chains[0].startDepth, 1);
  assertEquals(chains[0].endDepth, 4);
  assertEquals(chains[0].members.map((m) => m.squash), [
    "IDENTITY",
    "HARD_TANH",
    "IDENTITY",
    "IDENTITY",
  ]);
  assertEquals(chains[0].members.map((m) => m.fanOut), [1, 1, 1, 0]);
});

Deno.test("SerialChains - a depth level with two neurons breaks the chain", () => {
  // input → {a, b} → c → output: depth 1 holds two neurons, so the only
  // single-occupancy run left is c → output.
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "c", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "input-0", toUUID: "b", weight: 1 },
      { fromUUID: "a", toUUID: "c", weight: 1 },
      { fromUUID: "b", toUUID: "c", weight: 1 },
      { fromUUID: "c", toUUID: "output-0", weight: 1 },
    ],
  });

  const chains = findSerialChains(creature);
  assertEquals(chains.length, 1);
  assertEquals(chains[0].startDepth, 2);
  assertEquals(chains[0].endDepth, 3);
});

Deno.test("SerialChains - a wide network has no chain at all", () => {
  const wide: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "input-1", toUUID: "b", weight: 1 },
      { fromUUID: "a", toUUID: "output-0", weight: 1 },
      { fromUUID: "b", toUUID: "output-1", weight: 1 },
    ],
  };

  assertEquals(findSerialChains(Creature.fromJSON(wide)).length, 0);
  assertEquals(longestSerialChain(Creature.fromJSON(wide)), undefined);
});

Deno.test("SerialChains - the GRQ creature carries the depth 34-61 single-file tail", async () => {
  const json = JSON.parse(
    await Deno.readTextFile("test/data/grq-23-forests-constants.json"),
  );
  const creature = Creature.fromJSON(json);

  const chain = longestSerialChain(creature);
  assertNotEquals(chain, undefined, "the GRQ creature must have a chain");
  assertEquals(chain!.startDepth, 34);
  assertEquals(chain!.endDepth, 61);
  assertEquals(chain!.members.length, 28);

  // Issue #3972's claim: the chain is built from gradient-hostile activations.
  const hostile = new Set(["HARD_TANH", "MINIMUM", "MAXIMUM", "IF"]);
  const hostileCount =
    chain!.members.filter((m) => hostile.has(m.squash ?? "")).length;
  assertEquals(
    hostileCount >= 20,
    true,
    `expected the tail to be dominated by zero-derivative constructs, got ${hostileCount}/28`,
  );
});
