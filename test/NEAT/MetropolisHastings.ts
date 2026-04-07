import { assertEquals } from "@std/assert";
import {
  computeCreatureWeightBiasPenalty,
  isTopologyMutation,
  metropolisHastingsAccept,
} from "@neat/MetropolisHastings.ts";
import { Creature } from "@creature";

// --- metropolisHastingsAccept tests ---

Deno.test("M-H: improving mutations are always accepted", () => {
  // Negative delta = improvement
  assertEquals(metropolisHastingsAccept(-1.0, 1.0, 0.99), true);
  assertEquals(metropolisHastingsAccept(-0.001, 0.01, 0.99), true);
  assertEquals(metropolisHastingsAccept(-100.0, 0.001, 0.99), true);
});

Deno.test("M-H: zero delta is always accepted", () => {
  assertEquals(metropolisHastingsAccept(0, 1.0, 0.99), true);
  assertEquals(metropolisHastingsAccept(0, 0.001, 0.99), true);
});

Deno.test("M-H: at zero temperature, worsening mutations are rejected", () => {
  assertEquals(metropolisHastingsAccept(0.1, 0, 0.01), false);
  assertEquals(metropolisHastingsAccept(1.0, 0, 0.0001), false);
});

Deno.test("M-H: at very low temperature, behaviour approximates greedy", () => {
  const temperature = 1e-10;
  // Even tiny worsening: exp(-0.001 / 1e-10) ≈ 0
  assertEquals(metropolisHastingsAccept(0.001, temperature, 0.01), false);
});

Deno.test("M-H: at high temperature, most worsening mutations accepted", () => {
  const temperature = 1000.0;
  // exp(-1.0 / 1000) ≈ 0.999 — very high acceptance
  // With randomValue = 0.99 (< 0.999), should accept
  assertEquals(metropolisHastingsAccept(1.0, temperature, 0.99), true);
});

Deno.test("M-H: worsening mutation accepted when random below threshold", () => {
  // delta=1.0, T=1.0 → probability = exp(-1) ≈ 0.3679
  // randomValue = 0.3 < 0.3679 → accept
  assertEquals(metropolisHastingsAccept(1.0, 1.0, 0.3), true);
});

Deno.test("M-H: worsening mutation rejected when random above threshold", () => {
  // delta=1.0, T=1.0 → probability = exp(-1) ≈ 0.3679
  // randomValue = 0.5 > 0.3679 → reject
  assertEquals(metropolisHastingsAccept(1.0, 1.0, 0.5), false);
});

Deno.test("M-H: large worsening has low acceptance probability", () => {
  // delta=10.0, T=1.0 → probability = exp(-10) ≈ 4.54e-5
  // randomValue = 0.0001 > 4.54e-5 → reject
  assertEquals(metropolisHastingsAccept(10.0, 1.0, 0.0001), false);
});

// --- isTopologyMutation tests ---

Deno.test("isTopologyMutation: topology mutations identified correctly", () => {
  assertEquals(isTopologyMutation("ADD_NODE"), true);
  assertEquals(isTopologyMutation("SUB_NODE"), true);
  assertEquals(isTopologyMutation("ADD_CONN"), true);
  assertEquals(isTopologyMutation("SUB_CONN"), true);
  assertEquals(isTopologyMutation("ADD_SELF_CONN"), true);
  assertEquals(isTopologyMutation("SUB_SELF_CONN"), true);
  assertEquals(isTopologyMutation("ADD_BACK_CONN"), true);
  assertEquals(isTopologyMutation("SUB_BACK_CONN"), true);
  assertEquals(isTopologyMutation("SWAP_NODES"), true);
  assertEquals(isTopologyMutation("MOD_SQUASH"), true);
});

Deno.test("isTopologyMutation: weight/bias mutations are not topology", () => {
  assertEquals(isTopologyMutation("MOD_WEIGHT"), false);
  assertEquals(isTopologyMutation("MOD_BIAS"), false);
});

// --- computeCreatureWeightBiasPenalty tests ---

Deno.test("computeCreatureWeightBiasPenalty: small weights yield low penalty", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  // Set small weights
  for (const synapse of creature.synapses) {
    synapse.weight = 0.5;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = 0.1;
  }

  const penalty = computeCreatureWeightBiasPenalty(creature);
  assertEquals(penalty >= 0, true);
  assertEquals(penalty < 0.5, true); // Small weights → small penalty
});

Deno.test("computeCreatureWeightBiasPenalty: large weights yield high penalty", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  // Set large weights
  for (const synapse of creature.synapses) {
    synapse.weight = 100.0;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = 50.0;
  }

  const penalty = computeCreatureWeightBiasPenalty(creature);
  assertEquals(penalty > 0.5, true); // Large weights → high penalty
});

Deno.test("computeCreatureWeightBiasPenalty: zero weights yield zero penalty", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  for (const synapse of creature.synapses) {
    synapse.weight = 0;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = 0;
  }

  const penalty = computeCreatureWeightBiasPenalty(creature);
  assertEquals(penalty, 0);
});
