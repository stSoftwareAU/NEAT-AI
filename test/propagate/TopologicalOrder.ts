/**
 * Tests for TopologicalOrder.ts
 *
 * Issue #1641 - Verifies that the reverse topological order computation
 * produces correct orderings for different network topologies.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { computeReverseTopologicalOrder } from "../../src/propagate/TopologicalOrder.ts";

Deno.test("TopologicalOrder - simple chain produces output-first order", () => {
  // A → H1 → H2 → O
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // Output neuron should come first in reverse topological order.
  const outputIdx = creature.neurons.findIndex((n) => n.uuid === "output-0");
  assertEquals(order[0], outputIdx, "Output neuron should be first");

  // h2 should come before h1 (h2 is closer to output).
  const h1Idx = creature.neurons.findIndex((n) => n.uuid === "h1");
  const h2Idx = creature.neurons.findIndex((n) => n.uuid === "h2");
  const h2OrderPos = order.indexOf(h2Idx);
  const h1OrderPos = order.indexOf(h1Idx);
  assertEquals(
    h2OrderPos < h1OrderPos,
    true,
    "h2 should be processed before h1 in reverse topological order",
  );
});

Deno.test("TopologicalOrder - excludes input neurons", () => {
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "input-2", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // No index should be less than creature.input (no input neurons).
  for (const idx of order) {
    assertEquals(
      idx >= creature.input,
      true,
      `Index ${idx} should not be an input neuron`,
    );
  }
});

Deno.test("TopologicalOrder - diamond topology orders correctly", () => {
  // Input → H1 → O
  //       ↘ H2 ↗
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-0", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // Output neuron should come first.
  const outputIdx = creature.neurons.findIndex((n) => n.uuid === "output-0");
  assertEquals(order[0], outputIdx, "Output neuron should be first");

  // All non-input neurons should be included.
  assertEquals(order.length, 3, "Should include all 3 non-input neurons");
});

Deno.test("TopologicalOrder - multiple outputs", () => {
  const json: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // Both output neurons should come before h1.
  const h1Idx = creature.neurons.findIndex((n) => n.uuid === "h1");
  const o1Idx = creature.neurons.findIndex((n) => n.uuid === "output-0");
  const o2Idx = creature.neurons.findIndex((n) => n.uuid === "output-1");

  const h1Pos = order.indexOf(h1Idx);
  const o1Pos = order.indexOf(o1Idx);
  const o2Pos = order.indexOf(o2Idx);

  assertEquals(
    o1Pos < h1Pos,
    true,
    "Output o1 should be processed before hidden h1",
  );
  assertEquals(
    o2Pos < h1Pos,
    true,
    "Output o2 should be processed before hidden h1",
  );
});

Deno.test("TopologicalOrder - handles self-loops", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h1", weight: 0.5 }, // Self-loop
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // Should still produce valid order despite self-loop.
  assertEquals(order.length, 2, "Should include all non-input neurons");
  const outputIdx = creature.neurons.findIndex((n) => n.uuid === "output-0");
  assertEquals(order[0], outputIdx, "Output neuron should be first");
});

Deno.test("TopologicalOrder - visits each non-input neuron exactly once", () => {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h3", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "input-2", toUUID: "h3", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "h3", weight: 1 },
      { fromUUID: "h3", toUUID: "output-0", weight: 1 },
      { fromUUID: "h1", toUUID: "output-1", weight: 1 },
      { fromUUID: "h2", toUUID: "output-1", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // Should have exactly 5 entries (3 hidden + 2 output).
  assertEquals(order.length, 5, "Should include all 5 non-input neurons");

  // No duplicates.
  const unique = new Set(order);
  assertEquals(unique.size, order.length, "No duplicate entries allowed");
});

Deno.test("TopologicalOrder - disconnected neuron included", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h-disconnected", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      // h-disconnected has no connections
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // All non-input neurons should be included, even disconnected ones.
  assertEquals(order.length, 3, "Should include disconnected neuron too");
});

Deno.test("TopologicalOrder - recurrent connection handled", () => {
  // H1 → H2 → O, but also H2 → H1 (recurrent/cycle).
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "h1", weight: 0.5 }, // Recurrent
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const order = computeReverseTopologicalOrder(creature);

  // Should still include all non-input neurons.
  assertEquals(order.length, 3, "Should include all non-input neurons");

  // Output should still come first.
  const outputIdx = creature.neurons.findIndex((n) => n.uuid === "output-0");
  assertEquals(order[0], outputIdx, "Output neuron should be first");

  // No duplicates.
  const unique = new Set(order);
  assertEquals(unique.size, order.length, "No duplicate entries allowed");
});
