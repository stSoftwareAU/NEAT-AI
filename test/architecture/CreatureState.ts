/**
 * Unit tests for CreatureState and NeuronState.
 *
 * Issue #1407: Targeted unit tests for architecture core - neural network
 * state tracking including activation tracing, lazy initialisation, and
 * state clearing.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  CreatureState,
  NeuronState,
} from "../../src/architecture/CreatureState.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";

// --- NeuronState tests ---

Deno.test("NeuronState - initialises with correct defaults", () => {
  const ns = new NeuronState();

  assertEquals(ns.count, 0);
  assertEquals(ns.totalBias, 0);
  assertEquals(ns.totalAdjustedBias, 0);
  assertEquals(ns.hintValue, 0);
  assertEquals(ns.maximumActivation, -Infinity);
  assertEquals(ns.minimumActivation, Infinity);
  assertEquals(ns.totalActivation, 0);
  assertEquals(ns.totalErrorAbsolute, 0);
  assertEquals(ns.noChange, undefined);
});

Deno.test("NeuronState - traceActivation updates min/max and total", () => {
  const ns = new NeuronState();

  ns.traceActivation(0.5);
  assertEquals(ns.maximumActivation, 0.5);
  assertEquals(ns.minimumActivation, 0.5);
  assertEquals(ns.totalActivation, 0.5);

  ns.traceActivation(0.8);
  assertEquals(ns.maximumActivation, 0.8);
  assertEquals(ns.minimumActivation, 0.5);

  ns.traceActivation(0.2);
  assertEquals(ns.maximumActivation, 0.8);
  assertEquals(ns.minimumActivation, 0.2);
});

Deno.test("NeuronState - traceActivation accumulates total", () => {
  const ns = new NeuronState();

  ns.traceActivation(1.0);
  ns.traceActivation(2.0);
  ns.traceActivation(3.0);

  assertEquals(ns.totalActivation, 6.0);
});

Deno.test("NeuronState - traceActivation skips NaN (Issue #1314)", () => {
  const ns = new NeuronState();

  ns.traceActivation(1.0);
  ns.traceActivation(NaN);

  assertEquals(ns.maximumActivation, 1.0);
  assertEquals(ns.minimumActivation, 1.0);
  assertEquals(ns.totalActivation, 1.0);
});

Deno.test("NeuronState - traceActivation skips Infinity (Issue #1314)", () => {
  const ns = new NeuronState();

  ns.traceActivation(0.5);
  ns.traceActivation(Infinity);
  ns.traceActivation(-Infinity);

  assertEquals(ns.maximumActivation, 0.5);
  assertEquals(ns.minimumActivation, 0.5);
  assertEquals(ns.totalActivation, 0.5);
});

Deno.test("NeuronState - traceActivation with negative values", () => {
  const ns = new NeuronState();

  ns.traceActivation(-3.0);
  ns.traceActivation(-1.0);

  assertEquals(ns.maximumActivation, -1.0);
  assertEquals(ns.minimumActivation, -3.0);
  assertEquals(ns.totalActivation, -4.0);
});

Deno.test("NeuronState - traceActivation with zero", () => {
  const ns = new NeuronState();

  ns.traceActivation(0);

  assertEquals(ns.maximumActivation, 0);
  assertEquals(ns.minimumActivation, 0);
  assertEquals(ns.totalActivation, 0);
});

Deno.test("NeuronState - traceActivation only with non-finite values leaves defaults", () => {
  const ns = new NeuronState();

  ns.traceActivation(NaN);
  ns.traceActivation(Infinity);
  ns.traceActivation(-Infinity);

  // Should remain at initial defaults since all values were skipped
  assertEquals(ns.maximumActivation, -Infinity);
  assertEquals(ns.minimumActivation, Infinity);
  assertEquals(ns.totalActivation, 0);
});

// --- CreatureState tests ---

Deno.test("CreatureState - node() lazily creates NeuronState", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  const ns = state.node(0);
  assert(ns instanceof NeuronState);

  // Same instance on repeated access
  const ns2 = state.node(0);
  assert(ns === ns2);
});

Deno.test("CreatureState - node() creates independent states per index", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  const ns0 = state.node(0);
  const ns1 = state.node(1);

  assert(ns0 !== ns1);

  ns0.count = 5;
  assertEquals(ns1.count, 0);
});

Deno.test("CreatureState - connection() lazily creates SynapseState", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  const cs = state.connection(0, 1);
  assert(cs instanceof SynapseState);

  // Same instance on repeated access
  const cs2 = state.connection(0, 1);
  assert(cs === cs2);
});

Deno.test("CreatureState - connection() creates independent states per pair", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  const cs01 = state.connection(0, 1);
  const cs02 = state.connection(0, 2);
  const cs10 = state.connection(1, 0);

  assert(cs01 !== cs02);
  assert(cs01 !== cs10);
});

Deno.test("CreatureState - clear() resets all maps", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  state.node(0);
  state.node(1);
  state.connection(0, 1);
  state.preparedNeurons = true;

  state.clear();

  assertEquals(state.preparedNeurons, false);

  // After clear, node() should return a fresh NeuronState
  const ns = state.node(0);
  assertEquals(ns.count, 0);
});

Deno.test("CreatureState - makeActivation creates correct-sized array", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  const input = new Float32Array([0.5, 0.25]);
  const activations = state.makeActivation(input, false);

  assertEquals(activations.length, creature.neurons.length);
  assertEquals(activations[0], 0.5);
  assertEquals(activations[1], 0.25);
});

Deno.test("CreatureState - makeActivation reuses array when size matches", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  const input1 = new Float32Array([0.1, 0.2]);
  const a1 = state.makeActivation(input1, false);

  const input2 = new Float32Array([0.25, 0.75]);
  const a2 = state.makeActivation(input2, false);

  // Should be the same underlying array
  assert(a1 === a2);
  assertEquals(a2[0], 0.25);
  assertEquals(a2[1], 0.75);
});

Deno.test("CreatureState - makeActivation fills non-input with zero when not feedback", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // First pass sets values
  const input1 = new Float32Array([1.0, 1.0]);
  const a1 = state.makeActivation(input1, false);

  // Manually set a hidden neuron value
  a1[2] = 99.0;

  // Second pass should zero out non-input indices when feedbackLoop is false
  const input2 = new Float32Array([0.5, 0.5]);
  state.makeActivation(input2, false);

  assertEquals(a1[2], 0);
});

Deno.test("CreatureState - makeActivation preserves non-input with feedback loop", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 1, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // First pass
  const input1 = new Float32Array([1.0, 1.0]);
  const a1 = state.makeActivation(input1, false);
  a1[2] = 99.0;

  // Second pass with feedback loop should NOT zero out non-input indices
  const input2 = new Float32Array([0.5, 0.5]);
  state.makeActivation(input2, true);

  assertEquals(a1[2], 99.0);
});

Deno.test("CreatureState - collectNeuronErrors returns only neurons with errors", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "IDENTITY" }],
  });
  const state = new CreatureState(creature);

  // Set up some neuron states with errors
  const ns0 = state.node(2); // hidden neuron
  ns0.totalErrorAbsolute = 0.5;

  const ns1 = state.node(3); // hidden neuron
  ns1.totalErrorAbsolute = 0; // no error

  const errors = state.collectNeuronErrors();

  // Only neuron at index 2 has errors > 0
  assertEquals(errors.size, 1);
  assert(errors.has(creature.neurons[2].uuid));
});

Deno.test("CreatureState - collectNeuronErrors empty when no errors", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  const errors = state.collectNeuronErrors();
  assertEquals(errors.size, 0);
});

Deno.test("CreatureState - cacheAdjustedActivation is a DenseNumberMap", () => {
  const creature = new Creature(2, 1);
  const state = new CreatureState(creature);

  // Should be initialised and usable
  state.cacheAdjustedActivation.set(0, 1.5);
  assertEquals(state.cacheAdjustedActivation.get(0), 1.5);
});
