/**
 * Consolidated tests for RecordElasticity — verifying elastic error
 * distribution, feasibility factors, record value computation,
 * link building, and constrained redistribution.
 *
 * Merged from RecordElasticity.ts, RecordElasticityBehaviour.ts,
 * RecordElasticityTest.ts as part of Issue #1766 (propagation module
 * test audit).
 */
import { assertAlmostEquals, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { Neuron } from "@architecture/Neuron.ts";
import type { Synapse } from "@architecture/Synapse.ts";
import {
  buildRecordElasticLinks,
  constrainAndRedistributeRecordShares,
  distributeRecordError,
  getOrComputeRecordValue,
  type RecordElasticLink,
  recordTargetFeasibilityFactor,
} from "@propagate/RecordElasticity.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLink(opts: {
  weight: number;
  fromActivation: number;
  safeZoneFactor?: number;
  feasibilityFactor?: number;
  fromNeuron?: Neuron;
}): RecordElasticLink {
  const weight = opts.weight;
  const fromActivation = opts.fromActivation;
  return {
    synapse: { from: 0, to: 1, weight } as Synapse,
    fromNeuron: opts.fromNeuron ?? { type: "input" } as unknown as Neuron,
    fromActivation,
    fromValue: weight * fromActivation,
    safeZoneFactor: opts.safeZoneFactor ?? 1,
    feasibilityFactor: opts.feasibilityFactor ?? 1,
  };
}

function makeCreatureWithSquash(squashName: string): {
  creature: Creature;
  hiddenNeuron: Neuron;
} {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: squashName, bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return { creature, hiddenNeuron: creature.neurons[1] };
}

// ---------------------------------------------------------------------------
// distributeRecordError - basic behaviour
// ---------------------------------------------------------------------------

Deno.test("distributeRecordError - empty links returns empty shares", () => {
  const result = distributeRecordError(1.0, []);
  assertEquals(result.shares.length, 0);
});

Deno.test("distributeRecordError - non-finite error returns zero shares", () => {
  const link = makeLink({ weight: 1.0, fromActivation: 0.5 });
  const result = distributeRecordError(NaN, [link]);
  assertEquals(result.shares[0], 0);
});

Deno.test("distributeRecordError - single link gets all error", () => {
  const link = makeLink({ weight: 2.0, fromActivation: 0.5 });
  const result = distributeRecordError(3.0, [link]);
  assertAlmostEquals(result.shares[0], 3.0, 1e-9);
});

// ---------------------------------------------------------------------------
// distributeRecordError - weight-squared proportional distribution
// ---------------------------------------------------------------------------

Deno.test("distributeRecordError - distributes proportional to weight squared", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 2, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];
  const result = distributeRecordError(14, links);

  // weight² scores: 1, 4, 9 => total 14
  assertAlmostEquals(result.shares[0], 1, 1e-9);
  assertAlmostEquals(result.shares[1], 4, 1e-9);
  assertAlmostEquals(result.shares[2], 9, 1e-9);
});

Deno.test("distributeRecordError - shares sum to original error", () => {
  const links = [
    makeLink({ weight: 1.5, fromActivation: 0.3 }),
    makeLink({ weight: 2.5, fromActivation: 0.7 }),
    makeLink({ weight: 0.5, fromActivation: 0.1 }),
  ];
  const result = distributeRecordError(7.5, links);
  const sum = result.shares.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, 7.5, 1e-9, "Shares should sum to original error");
});

Deno.test("distributeRecordError - negative error distributes correctly", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];
  const result = distributeRecordError(-10, links);

  // Same weight² proportions but negative: 1:9
  assertAlmostEquals(result.shares[0], -1, 1e-9);
  assertAlmostEquals(result.shares[1], -9, 1e-9);
});

// ---------------------------------------------------------------------------
// distributeRecordError - gating via safeZoneFactor and feasibilityFactor
// ---------------------------------------------------------------------------

Deno.test("distributeRecordError - safeZoneFactor gates contribution", () => {
  const links = [
    makeLink({ weight: 2, fromActivation: 0.5, safeZoneFactor: 1 }),
    makeLink({ weight: 2, fromActivation: 0.5, safeZoneFactor: 0 }),
  ];
  const result = distributeRecordError(10, links);

  assertAlmostEquals(result.shares[0], 10, 1e-6);
  assertAlmostEquals(result.shares[1], 0, 1e-6);
});

Deno.test("distributeRecordError - feasibilityFactor gates contribution", () => {
  const links = [
    makeLink({ weight: 2, fromActivation: 0.5, feasibilityFactor: 1 }),
    makeLink({
      weight: 2,
      fromActivation: 0.5,
      safeZoneFactor: 1,
      feasibilityFactor: 0,
    }),
  ];
  const result = distributeRecordError(10, links);

  assertAlmostEquals(result.shares[0], 10, 1e-6);
  assertAlmostEquals(result.shares[1], 0, 1e-6);
});

Deno.test("distributeRecordError - both gates combine multiplicatively", () => {
  const links = [
    makeLink({
      weight: 2,
      fromActivation: 0.5,
      safeZoneFactor: 0.5,
      feasibilityFactor: 0.5,
    }),
    makeLink({
      weight: 2,
      fromActivation: 0.5,
      safeZoneFactor: 1.0,
      feasibilityFactor: 1.0,
    }),
  ];
  const result = distributeRecordError(10, links);

  // Gate scores: 0.5*0.5=0.25 vs 1.0*1.0=1.0
  // Weighted scores: 4*0.25=1 vs 4*1.0=4 => shares: 2 vs 8
  assertAlmostEquals(result.shares[0], 2, 1e-9);
  assertAlmostEquals(result.shares[1], 8, 1e-9);
});

// ---------------------------------------------------------------------------
// distributeRecordError - fallback behaviour
// ---------------------------------------------------------------------------

Deno.test("distributeRecordError - all blocked falls back to equal split", () => {
  const a = makeLink({ weight: 1.0, fromActivation: 0.0, safeZoneFactor: 0 });
  const b = makeLink({ weight: 1.0, fromActivation: 0.0, safeZoneFactor: 0 });
  const result = distributeRecordError(4.0, [a, b], {
    allowEqualFallback: true,
  });
  assertAlmostEquals(result.shares[0], 2.0, 1e-10);
  assertAlmostEquals(result.shares[1], 2.0, 1e-10);
});

Deno.test("distributeRecordError - no equal fallback returns zeroes", () => {
  const a = makeLink({ weight: 1.0, fromActivation: 0.0, safeZoneFactor: 0 });
  const b = makeLink({ weight: 1.0, fromActivation: 0.0, safeZoneFactor: 0 });
  const result = distributeRecordError(4.0, [a, b], {
    allowEqualFallback: false,
  });
  assertAlmostEquals(result.shares[0], 0, 1e-12);
  assertAlmostEquals(result.shares[1], 0, 1e-12);
});

// ---------------------------------------------------------------------------
// recordTargetFeasibilityFactor - non-finite handling
// ---------------------------------------------------------------------------

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
  const neuron = creature.neurons[1];

  assertEquals(recordTargetFeasibilityFactor(neuron, NaN), 0);
  assertEquals(recordTargetFeasibilityFactor(neuron, Infinity), 0);
  assertEquals(recordTargetFeasibilityFactor(neuron, -Infinity), 0);
});

// ---------------------------------------------------------------------------
// recordTargetFeasibilityFactor - per-squash behaviour
// ---------------------------------------------------------------------------

Deno.test("recordTargetFeasibilityFactor - IDENTITY always returns 1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("IDENTITY");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, 100),
    1,
    1e-9,
  );
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -100),
    1,
    1e-9,
  );
  assertAlmostEquals(recordTargetFeasibilityFactor(hiddenNeuron, 0), 1, 1e-9);
});

Deno.test("recordTargetFeasibilityFactor - ReLU returns 0.1 for negative target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ReLU");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -1.0),
    0.1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - ReLU returns 1 for positive target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ReLU");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, 5.0),
    1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - Swish returns 0.1 for negative target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("Swish");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -1.0),
    0.1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - Swish returns 1 for positive target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("Swish");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, 0.5),
    1,
    1e-9,
  );
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

Deno.test("recordTargetFeasibilityFactor - ABSOLUTE returns 0.1 for negative target", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ABSOLUTE");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -1),
    0.1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - SQUARE out-of-range returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SQUARE");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -1),
    0.1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - SQUARE in-range returns 1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SQUARE");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, 0.5),
    1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - SELU negative returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SELU");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -0.5),
    0.1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - SELU positive returns 1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("SELU");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, 0.5),
    1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - GELU negative returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("GELU");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -0.5),
    0.1,
    1e-9,
  );
});

Deno.test("recordTargetFeasibilityFactor - ELU negative returns 0.1", () => {
  const { hiddenNeuron } = makeCreatureWithSquash("ELU");
  assertAlmostEquals(
    recordTargetFeasibilityFactor(hiddenNeuron, -0.5),
    0.1,
    1e-9,
  );
});

// ---------------------------------------------------------------------------
// getOrComputeRecordValue
// ---------------------------------------------------------------------------

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
  discoverMap.set(outputNeuron.id, {
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

// ---------------------------------------------------------------------------
// buildRecordElasticLinks
// ---------------------------------------------------------------------------

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

  creature.activateAndTrace(
    new Float32Array([1.0, 0.5]),
    false,
    sparseConfig,
  );

  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const inward = creature.inwardConnections(outputNeuron.index);
  const discoverMap = new Map();

  const links = buildRecordElasticLinks(
    outputNeuron,
    inward,
    discoverMap,
    0.1,
  );

  assertEquals(links.length, 2);
  for (const link of links) {
    assertEquals(link.synapse !== undefined, true);
    assertEquals(link.fromNeuron !== undefined, true);
    assertEquals(Number.isFinite(link.fromActivation), true);
    assertEquals(Number.isFinite(link.safeZoneFactor), true);
    assertEquals(Number.isFinite(link.feasibilityFactor), true);
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

  // Default: input nodes excluded
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

// ---------------------------------------------------------------------------
// constrainAndRedistributeRecordShares
// ---------------------------------------------------------------------------

Deno.test("constrainAndRedistributeRecordShares - unconstrained shares pass through", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const result = constrainAndRedistributeRecordShares(10, links, [4, 6]);
  assertAlmostEquals(result[0], 4, 1e-9);
  assertAlmostEquals(result[1], 6, 1e-9);
});

Deno.test("constrainAndRedistributeRecordShares - handles empty links", () => {
  const shares = constrainAndRedistributeRecordShares(1.0, [], []);
  assertEquals(shares.length, 0);
});

Deno.test("constrainAndRedistributeRecordShares - zero-weight link gets zero share", () => {
  const links = [
    makeLink({ weight: 0, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const result = constrainAndRedistributeRecordShares(10, links, [5, 5]);
  assertAlmostEquals(result[0], 0, 1e-9);
  assertAlmostEquals(result[1], 10, 1e-6);
});

Deno.test("constrainAndRedistributeRecordShares - blocked links redistribute to open links", () => {
  const links = [
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const result = constrainAndRedistributeRecordShares(10, links, [3, 3, 4]);

  assertAlmostEquals(result[0], 0, 1e-9);
  const openSum = result[1] + result[2];
  assertAlmostEquals(openSum, 10, 1e-6, "Open links should absorb all error");
});

Deno.test("constrainAndRedistributeRecordShares - all blocked results in zero shares", () => {
  const links = [
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
    makeLink({
      weight: 1,
      fromActivation: 0.5,
      safeZoneFactor: 0,
      feasibilityFactor: 0,
    }),
  ];
  const result = constrainAndRedistributeRecordShares(10, links, [5, 5]);
  assertAlmostEquals(result[0], 0, 1e-9);
  assertAlmostEquals(result[1], 0, 1e-9);
});

Deno.test("constrainAndRedistributeRecordShares - shares sum preserved", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 2, fromActivation: 0.5 }),
    makeLink({ weight: 3, fromActivation: 0.5 }),
  ];
  const result = constrainAndRedistributeRecordShares(10, links, [2, 3, 5]);
  const sum = result.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, 10, 1e-6, "Total shares should be preserved");
});

Deno.test("constrainAndRedistributeRecordShares - handles negative error", () => {
  const links = [
    makeLink({ weight: 1, fromActivation: 0.5 }),
    makeLink({ weight: 1, fromActivation: 0.5 }),
  ];
  const result = constrainAndRedistributeRecordShares(-10, links, [-3, -7]);
  const sum = result.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, -10, 1e-6);
});

// ---------------------------------------------------------------------------
// constrainAndRedistributeRecordShares - with real creature
// ---------------------------------------------------------------------------

Deno.test("constrainAndRedistributeRecordShares - redistributes away from range-limited squash", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-abs", squash: "ABSOLUTE", bias: 0 },
      { type: "hidden", uuid: "hidden-id", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-abs", weight: 1 },
      { fromUUID: "input-0", toUUID: "hidden-id", weight: 1 },
      { fromUUID: "hidden-abs", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-id", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  creature.activate(new Float32Array([0.5]));

  const absNeuron = creature.neurons[1];
  const idNeuron = creature.neurons[2];

  const links: RecordElasticLink[] = [
    {
      synapse: creature.synapses[2],
      fromNeuron: absNeuron,
      fromActivation: 0.5,
      fromValue: 0.5,
      safeZoneFactor: 1,
      feasibilityFactor: recordTargetFeasibilityFactor(absNeuron, -1),
    },
    {
      synapse: creature.synapses[3],
      fromNeuron: idNeuron,
      fromActivation: 0.5,
      fromValue: 0.5,
      safeZoneFactor: 1,
      feasibilityFactor: recordTargetFeasibilityFactor(idNeuron, -1),
    },
  ];

  // ABSOLUTE neuron should have lower feasibility for negative target
  assertAlmostEquals(links[0].feasibilityFactor, 0.1, 1e-9);
  assertAlmostEquals(links[1].feasibilityFactor, 1, 1e-9);

  const result = distributeRecordError(-2, links);

  // IDENTITY link should absorb more negative error
  assertGreater(
    Math.abs(result.shares[1]),
    Math.abs(result.shares[0]),
    "IDENTITY link should absorb more error than ABSOLUTE link",
  );
});
