/**
 * Tests for flat-array nodeMap optimisation in CreatureState.
 *
 * Issue #1537: Replace CreatureState nodeMap with flat array for O(1)
 * neuron state access.
 *
 * These tests verify that the flat-array implementation provides correct
 * behaviour: direct indexing, in-place reset on clear(), and proper
 * iteration for collectNeuronErrors().
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  CreatureState,
  NeuronState,
} from "../../src/architecture/CreatureState.ts";

Deno.test("CreatureState flat array - node() returns NeuronState with defaults for all indices", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // Every neuron index should return a valid NeuronState with defaults
  for (let i = 0; i < creature.neurons.length; i++) {
    const ns = state.node(i);
    assert(ns instanceof NeuronState);
    assertEquals(ns.count, 0, `Neuron ${i} should start with count 0`);
    assertEquals(
      ns.totalActivation,
      0,
      `Neuron ${i} should start with totalActivation 0`,
    );
    assertEquals(
      ns.totalErrorAbsolute,
      0,
      `Neuron ${i} should start with totalErrorAbsolute 0`,
    );
  }
});

Deno.test("CreatureState flat array - node() returns same reference on repeated access", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  for (let i = 0; i < creature.neurons.length; i++) {
    const ns1 = state.node(i);
    ns1.count = 42;
    const ns2 = state.node(i);
    assert(ns1 === ns2, `node(${i}) should return same reference`);
    assertEquals(ns2.count, 42);
  }
});

Deno.test("CreatureState flat array - clear() resets all neuron states to defaults", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // Modify some neuron states
  for (let i = 0; i < creature.neurons.length; i++) {
    const ns = state.node(i);
    ns.count = 10;
    ns.totalBias = 1.5;
    ns.totalAdjustedBias = 2.0;
    ns.hintValue = 0.5;
    ns.maximumActivation = 0.9;
    ns.minimumActivation = -0.9;
    ns.totalActivation = 5.0;
    ns.totalErrorAbsolute = 0.3;
    ns.noChange = true;
    ns.batchBias = 0.1;
  }

  state.clear();

  // After clear, all states should be reset to defaults
  for (let i = 0; i < creature.neurons.length; i++) {
    const ns = state.node(i);
    assertEquals(ns.count, 0, `Neuron ${i} count should be 0 after clear`);
    assertEquals(ns.totalBias, 0, `Neuron ${i} totalBias should be 0`);
    assertEquals(
      ns.totalAdjustedBias,
      0,
      `Neuron ${i} totalAdjustedBias should be 0`,
    );
    assertEquals(ns.hintValue, 0, `Neuron ${i} hintValue should be 0`);
    assertEquals(
      ns.maximumActivation,
      -Infinity,
      `Neuron ${i} maximumActivation should be -Infinity`,
    );
    assertEquals(
      ns.minimumActivation,
      Infinity,
      `Neuron ${i} minimumActivation should be Infinity`,
    );
    assertEquals(
      ns.totalActivation,
      0,
      `Neuron ${i} totalActivation should be 0`,
    );
    assertEquals(
      ns.totalErrorAbsolute,
      0,
      `Neuron ${i} totalErrorAbsolute should be 0`,
    );
    assertEquals(
      ns.noChange,
      undefined,
      `Neuron ${i} noChange should be undefined`,
    );
    assertEquals(
      ns.batchBias,
      undefined,
      `Neuron ${i} batchBias should be undefined`,
    );
  }
});

Deno.test("CreatureState flat array - collectNeuronErrors iterates all neurons correctly", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 4, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // Set errors on specific hidden neurons (indices 2..5)
  const ns2 = state.node(2);
  ns2.totalErrorAbsolute = 0.5;

  const ns4 = state.node(4);
  ns4.totalErrorAbsolute = 0.8;

  // Neuron 3 has zero error, neuron 5 has zero error
  state.node(3).totalErrorAbsolute = 0;
  state.node(5).totalErrorAbsolute = 0;

  const errors = state.collectNeuronErrors();

  // Should only include neurons with errors > 0
  assertEquals(errors.size, 2);
  assert(errors.has(creature.neurons[2].id));
  assert(errors.has(creature.neurons[4].id));
});

Deno.test("CreatureState flat array - node() works after clear() and re-access", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // First pass: set values
  const ns0 = state.node(2);
  ns0.count = 99;

  // Clear
  state.clear();

  // Second pass: should get reset state
  const ns0After = state.node(2);
  assertEquals(ns0After.count, 0);
});
