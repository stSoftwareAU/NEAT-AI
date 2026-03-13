import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  buildRecordElasticLinks,
  constrainAndRedistributeRecordShares,
  distributeRecordError,
  getOrComputeRecordValue,
  type RecordElasticLink,
  recordTargetFeasibilityFactor,
} from "../../src/propagate/RecordElasticity.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

// --- distributeRecordError ---

Deno.test("distributeRecordError - returns zeroes for empty links", () => {
  const result = distributeRecordError(1.0, []);
  assertEquals(result.shares.length, 0);
});

Deno.test("distributeRecordError - returns zeroes for non-finite error", () => {
  const link = makeMockLink(1.0, 0.5, 1.0, 1.0);
  const result = distributeRecordError(NaN, [link]);
  assertEquals(result.shares[0], 0);
});

Deno.test("distributeRecordError - single link gets all error", () => {
  const link = makeMockLink(1.0, 0.5, 1.0, 1.0);
  const result = distributeRecordError(2.0, [link]);
  assertAlmostEquals(result.shares[0], 2.0, 1e-10);
});

Deno.test("distributeRecordError - distributes by weight-squared", () => {
  // Links use synapse.weight for distribution (weight-squared elasticity)
  const link1 = makeMockLink(2.0, 0.5, 1.0, 1.0); // weight=2
  const link2 = makeMockLink(1.0, 0.5, 1.0, 1.0); // weight=1

  const result = distributeRecordError(5.0, [link1, link2]);
  const total = result.shares[0] + result.shares[1];
  assertAlmostEquals(total, 5.0, 1e-10);

  // weight² ratio: 4:1, so link1 gets 4/5, link2 gets 1/5
  assert(
    result.shares[0] > result.shares[1],
    "Larger weight should get larger share",
  );
});

Deno.test("distributeRecordError - safeZoneFactor blocks allocation", () => {
  const open = makeMockLink(1.0, 0.5, 1.0, 1.0); // safeZone=1
  const blocked = makeMockLink(1.0, 0.5, 0.0, 1.0); // safeZone=0

  const result = distributeRecordError(3.0, [open, blocked]);
  // Blocked link should get less (or zero) share
  assert(
    Math.abs(result.shares[0]) >= Math.abs(result.shares[1]),
    "Blocked link should not dominate",
  );
});

Deno.test("distributeRecordError - all blocked falls back to equal split", () => {
  const a = makeMockLink(1.0, 0.0, 0.0, 0.0);
  const b = makeMockLink(1.0, 0.0, 0.0, 0.0);

  const result = distributeRecordError(4.0, [a, b], {
    allowEqualFallback: true,
  });
  assertAlmostEquals(result.shares[0], 2.0, 1e-10);
  assertAlmostEquals(result.shares[1], 2.0, 1e-10);
});

Deno.test("distributeRecordError - no equal fallback returns zeroes", () => {
  const a = makeMockLink(1.0, 0.0, 0.0, 0.0);
  const b = makeMockLink(1.0, 0.0, 0.0, 0.0);

  const result = distributeRecordError(4.0, [a, b], {
    allowEqualFallback: false,
  });
  assertEquals(result.shares[0], 0);
  assertEquals(result.shares[1], 0);
});

// --- recordTargetFeasibilityFactor ---

Deno.test("recordTargetFeasibilityFactor - returns 0 for non-finite activation", () => {
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
  const neuron = creature.neurons[1]; // output neuron

  assertEquals(recordTargetFeasibilityFactor(neuron, NaN), 0);
  assertEquals(recordTargetFeasibilityFactor(neuron, Infinity), 0);
});

Deno.test("recordTargetFeasibilityFactor - returns 1 for IDENTITY in range", () => {
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
  const neuron = creature.neurons[1];

  assertEquals(recordTargetFeasibilityFactor(neuron, 0.5), 1);
});

Deno.test("recordTargetFeasibilityFactor - ReLU returns 0.1 for negative target", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "ReLU", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const reluNeuron = creature.neurons[1]; // hidden neuron with ReLU

  // ReLU range is [0, ∞), negative target is out of range
  assertEquals(recordTargetFeasibilityFactor(reluNeuron, -1.0), 0.1);
});

Deno.test("recordTargetFeasibilityFactor - ReLU returns 1 for positive target", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "ReLU", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const reluNeuron = creature.neurons[1];

  assertEquals(recordTargetFeasibilityFactor(reluNeuron, 5.0), 1);
});

Deno.test("recordTargetFeasibilityFactor - Swish returns 0.1 for negative target", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "Swish", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const swishNeuron = creature.neurons[1];

  assertEquals(recordTargetFeasibilityFactor(swishNeuron, -1.0), 0.1);
});

Deno.test("recordTargetFeasibilityFactor - TANH returns 1 for in-range target", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const tanhNeuron = creature.neurons[1];

  assertEquals(recordTargetFeasibilityFactor(tanhNeuron, 0.5), 1);
});

// --- getOrComputeRecordValue ---

Deno.test("getOrComputeRecordValue - returns existing value from discoverMap", () => {
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
  const sparseConfig = new SparseConfig(
    json,
    createBackPropagationConfig({
      disableRandomSamples: true,
      learningRateStrategy: "fixed",
    }),
  );

  creature.activateAndTrace(new Float32Array([0.5]), false, sparseConfig);

  const discoverMap = new Map();
  const outputNeuron = creature.neurons[1];
  discoverMap.set(outputNeuron.uuid, {
    activation: 0.5,
    errors: [],
    value: 42,
  });

  const result = getOrComputeRecordValue(outputNeuron, discoverMap);
  assertEquals(result, 42);
});

Deno.test("getOrComputeRecordValue - computes value for input neuron", () => {
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
  const sparseConfig = new SparseConfig(
    json,
    createBackPropagationConfig({
      disableRandomSamples: true,
      learningRateStrategy: "fixed",
    }),
  );

  creature.activateAndTrace(new Float32Array([0.7]), false, sparseConfig);

  const discoverMap = new Map();
  const inputNeuron = creature.neurons[0];

  const result = getOrComputeRecordValue(inputNeuron, discoverMap);
  assertAlmostEquals(result, 0.7, 1e-5);
});

// --- buildRecordElasticLinks ---

Deno.test("buildRecordElasticLinks - builds links from inward synapses", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h2", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    disableRandomSamples: true,
    learningRateStrategy: "fixed",
  });
  const sparseConfig = new SparseConfig(json, config);

  creature.activateAndTrace(new Float32Array([1.0, 0.5]), false, sparseConfig);

  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const inward = creature.inwardConnections(outputNeuron.index);
  const discoverMap = new Map();

  const links = buildRecordElasticLinks(
    outputNeuron,
    inward,
    discoverMap,
    0.1,
  );

  // Should have 2 links (from h1 and h2, not from inputs by default)
  assertEquals(links.length, 2);
  for (const link of links) {
    assert(link.synapse !== undefined);
    assert(link.fromNeuron !== undefined);
    assert(Number.isFinite(link.fromActivation));
    assert(Number.isFinite(link.safeZoneFactor));
    assert(Number.isFinite(link.feasibilityFactor));
  }
});

Deno.test("buildRecordElasticLinks - includeInputNodes option", () => {
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
  const config = createBackPropagationConfig({
    disableRandomSamples: true,
    learningRateStrategy: "fixed",
  });
  const sparseConfig = new SparseConfig(json, config);

  creature.activateAndTrace(new Float32Array([1.0]), false, sparseConfig);

  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const inward = creature.inwardConnections(outputNeuron.index);
  const discoverMap = new Map();

  // Without includeInputNodes (default false)
  const linksDefault = buildRecordElasticLinks(
    outputNeuron,
    inward,
    discoverMap,
    0.1,
  );
  assertEquals(linksDefault.length, 0);

  // With includeInputNodes = true
  const linksIncluding = buildRecordElasticLinks(
    outputNeuron,
    inward,
    discoverMap,
    0.1,
    { includeInputNodes: true },
  );
  assertEquals(linksIncluding.length, 1);
});

// --- constrainAndRedistributeRecordShares ---

Deno.test("constrainAndRedistributeRecordShares - passes through unconstrained shares", () => {
  const link = makeMockLink(1.0, 0.5, 1.0, 1.0);
  const shares = constrainAndRedistributeRecordShares(
    1.0,
    [link],
    [1.0],
  );
  assertAlmostEquals(shares[0], 1.0, 1e-10);
});

Deno.test("constrainAndRedistributeRecordShares - handles empty links", () => {
  const shares = constrainAndRedistributeRecordShares(1.0, [], []);
  assertEquals(shares.length, 0);
});

// --- Helper to create mock RecordElasticLink ---

function makeMockLink(
  weight: number,
  fromActivation: number,
  safeZoneFactor: number,
  feasibilityFactor: number,
): RecordElasticLink {
  // Create a minimal mock that satisfies the RecordElasticLink type
  return {
    synapse: {
      weight,
      from: 0,
      to: 1,
    } as unknown as import("../../src/architecture/Synapse.ts").Synapse,
    fromNeuron: {
      type: "hidden",
      index: 0,
      uuid: "mock",
      findSquash: () => ({
        range: { low: -1, high: 1 },
        getName: () => "IDENTITY",
      }),
    } as unknown as import("../../src/architecture/Neuron.ts").Neuron,
    fromActivation,
    fromValue: weight * fromActivation,
    safeZoneFactor,
    feasibilityFactor,
  };
}
