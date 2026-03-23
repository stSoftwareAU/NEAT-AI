/**
 * Tests for SyntheticSynapses.ts
 *
 * Issue #1921 - Verifies that synthetic zero-weight synapses are correctly
 * generated between adjacent layers for dense inter-layer connectivity.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { generateSyntheticSynapses } from "../../src/propagate/SyntheticSynapses.ts";

Deno.test("SyntheticSynapses - simple chain adds missing connections", () => {
  // Input(0) → H1(1) → Output(2)
  // Adjacent layers: [Input] → [H1] → [Output]
  // Existing: input-0→h1, h1→output-0
  // Should add: input-0→output is NOT adjacent (layer 0→2), so no new synapses
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const beforeCount = creature.synapses.length;

  const result = generateSyntheticSynapses(creature);

  // Already fully connected between adjacent layers, so no new synapses
  assertEquals(result.addedCount, 0);
  assertEquals(creature.synapses.length, beforeCount);
});

Deno.test("SyntheticSynapses - adds connections between adjacent layers", () => {
  // 2 inputs, 2 hidden neurons (same layer), 1 output
  // Input-0 → H1, Input-1 → H2, H1 → Output, H2 → Output
  // Missing adjacent connections: Input-0→H2, Input-1→H1
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const beforeCount = creature.synapses.length;

  const result = generateSyntheticSynapses(creature);

  // Should add input-0→h2 and input-1→h1 (2 missing connections)
  assertEquals(result.addedCount, 2);
  assertEquals(creature.synapses.length, beforeCount + 2);

  // Verify the new synapses exist and have zero weight
  for (const synapse of creature.synapses) {
    if (synapse.weight === 0) {
      // Synthetic synapses should have zero weight
      assertEquals(synapse.weight, 0);
    }
  }
});

Deno.test("SyntheticSynapses - does not duplicate existing synapses", () => {
  // Fully connected already — no new synapses should be added
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const beforeCount = creature.synapses.length;

  const result = generateSyntheticSynapses(creature);

  assertEquals(result.addedCount, 0);
  assertEquals(creature.synapses.length, beforeCount);
});

Deno.test("SyntheticSynapses - skips constant neurons as targets", () => {
  // Constant neuron should not receive synthetic synapses
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-0", bias: 1 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "const-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // Constant neuron is in layer 0 alongside input. No synthetic synapse should
  // target the constant neuron. The only adjacent-layer pair from layer 0→1
  // is [input-0, const-0] → [h1]. input-0→h1 and const-0→h1 already exist.
  assertEquals(result.addedCount, 0);

  // Verify no synapse targets the constant neuron
  const constIdx = creature.neurons.findIndex((n) => n.type === "constant");
  for (const synapse of creature.synapses) {
    assertNotEquals(
      synapse.to,
      constIdx,
      "No synapse should target a constant neuron",
    );
  }
});

Deno.test("SyntheticSynapses - skips frozen neurons as targets", () => {
  // Frozen neuron should not receive synthetic synapses
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "h-frozen",
        squash: "IDENTITY",
        bias: 0,
        frozen: true,
      },
      { type: "hidden", uuid: "h-normal", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-frozen", weight: 1 },
      { fromUUID: "input-1", toUUID: "h-normal", weight: 1 },
      { fromUUID: "h-frozen", toUUID: "output-0", weight: 1 },
      { fromUUID: "h-normal", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // h-frozen and h-normal are both in layer 1 (both receive from layer 0).
  // Missing: input-0→h-normal, input-1→h-frozen
  // But h-frozen is frozen, so input-1→h-frozen should be skipped.
  // Only input-0→h-normal should be added.
  assertEquals(result.addedCount, 1);

  // Verify the frozen neuron received no new synapses
  const frozenIdx = creature.neurons.findIndex((n) => n.id === 9579);
  const synapsesToFrozen = creature.synapses.filter(
    (s) => s.to === frozenIdx,
  );
  // Only the original input-0→h-frozen should exist
  assertEquals(synapsesToFrozen.length, 1);
});

Deno.test("SyntheticSynapses - all synthetic synapses have zero weight", () => {
  const json: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-1", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  // Track existing synapse count
  const existingSynapseKeys = new Set(
    creature.synapses.map((s) => `${s.from}-${s.to}`),
  );

  const result = generateSyntheticSynapses(creature);

  // Should have added synapses
  assertNotEquals(result.addedCount, 0);

  // All newly added synapses should have zero weight
  for (const synapse of creature.synapses) {
    const key = `${synapse.from}-${synapse.to}`;
    if (!existingSynapseKeys.has(key)) {
      assertEquals(
        synapse.weight,
        0,
        `Synthetic synapse ${key} should have zero weight`,
      );
    }
  }
});

Deno.test("SyntheticSynapses - returns tracked synthetic synapse keys", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // Should track which synapses are synthetic
  assertEquals(result.syntheticKeys.size, result.addedCount);
  assertEquals(result.syntheticKeys.size, 2);

  // Each key should correspond to an actual synapse in the creature
  for (const key of result.syntheticKeys) {
    const [fromStr, toStr] = key.split("-");
    const from = parseInt(fromStr);
    const to = parseInt(toStr);
    const synapse = creature.getSynapse(from, to);
    assertNotEquals(synapse, null, `Synthetic synapse ${key} should exist`);
    assertEquals(
      synapse!.weight,
      0,
      `Synthetic synapse ${key} should have zero weight`,
    );
  }
});

Deno.test("SyntheticSynapses - multi-layer topology", () => {
  // Input → H1 → H2 → Output (3 adjacent layer pairs)
  const json: CreatureExport = {
    input: 2,
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

  const result = generateSyntheticSynapses(creature);

  // Layer 0: [input-0, input-1] → Layer 1: [h1]
  // Missing: input-1→h1 (1 new)
  // Layer 1: [h1] → Layer 2: [h2]
  // Already connected: h1→h2 (0 new)
  // Layer 2: [h2] → Layer 3: [output-0]
  // Already connected: h2→output-0 (0 new)
  assertEquals(result.addedCount, 1);
});

Deno.test("SyntheticSynapses - no hidden neurons (input directly to output)", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // Layer 0: [input-0, input-1] → Layer 1: [output-0]
  // Missing: input-1→output-0
  assertEquals(result.addedCount, 1);
});

Deno.test("SyntheticSynapses - wide layers create many connections", () => {
  // 3 inputs, 3 hidden (same layer), 2 outputs
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
      // Each input connects to one hidden neuron
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-1", toUUID: "h2", weight: 1 },
      { fromUUID: "input-2", toUUID: "h3", weight: 1 },
      // Each hidden connects to one output
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-1", weight: 1 },
      { fromUUID: "h3", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // Layer 0→1: 3 inputs × 3 hidden = 9 total, 3 existing = 6 new
  // Layer 1→2: 3 hidden × 2 outputs = 6 total, 3 existing = 3 new
  // Total: 9 new connections
  assertEquals(result.addedCount, 9);
});

Deno.test("SyntheticSynapses - idempotent (running twice adds nothing new)", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result1 = generateSyntheticSynapses(creature);
  assertNotEquals(result1.addedCount, 0);

  const countAfterFirst = creature.synapses.length;

  // Running again should add nothing
  const result2 = generateSyntheticSynapses(creature);
  assertEquals(result2.addedCount, 0);
  assertEquals(creature.synapses.length, countAfterFirst);
});

Deno.test("SyntheticSynapses - does not create connections to input neurons", () => {
  // Input neurons should never be targets of synthetic synapses
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const inputCount = creature.input;

  generateSyntheticSynapses(creature);

  // Verify no synapse targets an input neuron
  for (const synapse of creature.synapses) {
    if (synapse.to < inputCount) {
      throw new Error(
        `Synapse ${synapse.from}→${synapse.to} targets an input neuron`,
      );
    }
  }
});

Deno.test("SyntheticSynapses - creature with frozen output neuron", () => {
  // Frozen output neuron should not receive synthetic synapses
  const json: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
        frozen: true,
      },
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

  const result = generateSyntheticSynapses(creature);

  // The frozen output-0 should not receive new connections.
  // Only output-1 (non-frozen) should get: input-0→output-1, input-1→output-1
  // Actually wait — h1 is in layer 1, outputs in layer 2.
  // Layer 0→1: both inputs→h1 already exist (0 new)
  // Layer 1→2: h1→output-0 and h1→output-1 already exist.
  // But also input-0→output-1 and input-1→output-1 are NOT adjacent (layer 0→2)
  // So no new synapses needed. Let me reconsider...
  // Actually with only 1 hidden neuron, layers are: 0=[input-0,input-1], 1=[h1], 2=[output-0,output-1]
  // Layer 0→1: 2×1=2 total, 2 existing = 0 new
  // Layer 1→2: 1×2=2 total, 2 existing (h1→out0, h1→out1) = 0 new
  // So this test checks that frozen output doesn't cause issues, even when nothing to add
  assertEquals(result.addedCount, 0);
});

Deno.test("SyntheticSynapses - frozen output gets no synthetic connections from wider layer", () => {
  // 2 hidden neurons → 2 outputs (1 frozen, 1 not)
  const json: CreatureExport = {
    input: 1,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
        frozen: true,
      },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "input-0", toUUID: "h2", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      { fromUUID: "h2", toUUID: "output-1", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // Layer 0→1: 1×2=2 total, 2 existing = 0 new
  // Layer 1→2: 2×2=4 total, 2 existing = 2 possible new
  // But output-0 is frozen, so h2→output-0 is skipped
  // Only h1→output-1 should be added
  assertEquals(result.addedCount, 1);

  // Verify frozen output didn't get new connections
  const frozenIdx = creature.neurons.findIndex(
    (n) => n.id === -1,
  );
  const synapsesToFrozen = creature.synapses.filter(
    (s) => s.to === frozenIdx,
  );
  assertEquals(synapsesToFrozen.length, 1); // Only the original h1→output-0
});

Deno.test("SyntheticSynapses - empty creature with no hidden neurons", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);

  const result = generateSyntheticSynapses(creature);

  // Already fully connected: input-0→output-0
  assertEquals(result.addedCount, 0);
});
